// 寻迹语音输入（ChatDock 灵动岛长按）：macOS 原生语音识别同步桥。
// SFSpeechRecognizer(zh-CN) + AVAudioEngine 麦克风流 + 实时部分结果。
//
// 线程模型：JS 持续按住胶囊 → speech_start（授权窗泵 runloop + 启动识别）→
// speech_poll 轮询（每 ~200ms 拷贝最新部分转写）→ speech_stop 停止。
// 状态收敛在 C 侧单例，重复 start 自动重置。
//
// 权限（macOS 机理，与定位同）：必须 .app bundle + Info.plist 描述串才弹窗；
// 无描述串的裸二进制会被直接拒绝。需要：
//   NSMicrophoneUsageDescription（引擎首次启动时 TCC 弹窗）
//   NSSpeechRecognitionUsageDescription（SFSpeechRecognizer 授权窗）
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

static BOOL g_running = NO;
static NSMutableString *g_text = nil;
static SFSpeechRecognizer *g_rec = nil;
static AVAudioEngine *g_engine = nil;
static SFSpeechAudioBufferRecognitionRequest *g_req = nil;
static NSString *g_lastErr = nil; // 识别任务报错（诊断：识别器拒绝/无模型/网络）

void onethu_speech_stop(void);

int onethu_speech_supported(void) {
    if (@available(macOS 10.15, *)) {
        return SFSpeechRecognizer.authorizationStatus != SFSpeechRecognizerAuthorizationStatusRestricted ? 1 : 0;
    }
    return 0;
}

/** 泵主 runloop 同步等待 SFSpeech 授权窗点选（拒绝/超时按失败处理） */
static BOOL waitSpeechAuth(void) {
    SFSpeechRecognizerAuthorizationStatus st = SFSpeechRecognizer.authorizationStatus;
    if (st == SFSpeechRecognizerAuthorizationStatusDenied) return NO;
    if (st == SFSpeechRecognizerAuthorizationStatusAuthorized) return YES;
    __block BOOL done = NO;
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus s) { done = YES; }];
    NSDate *lim = [NSDate dateWithTimeIntervalSinceNow:30];
    while (!done && [lim timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.2]];
    }
    return SFSpeechRecognizer.authorizationStatus == SFSpeechRecognizerAuthorizationStatusAuthorized;
}

/** 开始一次识别会话（重复调用先停旧的）。返回：1 成功 0 无权限 -1 引擎/模型失败 */
int onethu_speech_start(void) {
    if (@available(macOS 10.15, *)) {
        if (g_running) onethu_speech_stop();
        if (!waitSpeechAuth()) return 0;

        SFSpeechRecognizer *rec = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:@"zh-CN"]];
        if (!rec) return -1; // 无中文语音模型（离线未下载/无网络）
        g_rec = rec;
        g_text = [NSMutableString new];
        g_req = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
        g_req.shouldReportPartialResults = YES;

        // 音频引擎：首次启动触发麦克风 TCC 窗（无描述串则此处直接失败）
        AVAudioEngine *engine = [[AVAudioEngine alloc] init];
        AVAudioInputNode *input = [engine inputNode];
        AVAudioFormat *fmt = [input outputFormatForBus:0];
        [input installTapOnBus:0 bufferSize:4096 format:fmt block:^(AVAudioPCMBuffer *b, AVAudioTime *when) {
            if (g_req != nil) [g_req appendAudioPCMBuffer:b];
        }];
        [engine prepare];
        // 关键顺序（实测验证）：识别任务必须在引擎启动前创建——SFSpeechAudioBuffer
        // BufferRecognitionRequest 的音频必须晚于任务到达，且需实时节奏投喂，
        // 瞬时灌入会被静默丢弃（task 后建/一次性灌包 → 零结果零报错）。
        // 麦克风 tap 是天然逐帧实时的，满足节奏要求。
        [rec recognitionTaskWithRequest:g_req resultHandler:^(SFSpeechRecognitionResult *r, NSError *e) {
            // 部分结果持续覆盖（最终结果 >= 最后一次部分结果）
            if (r != nil && g_text != nil) {
                @synchronized(g_text) { [g_text setString:r.bestTranscription.formattedString]; }
            }
            if (e != nil) g_lastErr = e.localizedDescription;
            if (e != nil || r.isFinal) {
                [engine stop];
                [[engine inputNode] removeTapOnBus:0];
                g_running = NO; // 自然收尾（用户还在按住时 poll 读到最终文本）
            }
        }];
        NSError *err = nil;
        if (![engine startAndReturnError:&err]) {
            g_rec = nil; g_text = nil; g_req = nil;
            return -1;
        }
        g_engine = engine;
        g_running = YES;
        return 1;
    }
    return 0;
}

/** [诊断] 最近一次识别任务错误（空串=无）；探针与排障用 */
const char *onethu_speech_last_error(void) {
    return g_lastErr == nil ? "" : g_lastErr.UTF8String;
}

/** [诊断钩子] 把音频文件直接喂给识别请求（绕过麦克风，测试转写数据链）。仅探针使用。 */
int onethu_speech_feed_file(const char *path) {
    if (!g_req) return -1;
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
    NSError *ferr = nil;
    AVAudioFile *f = [[AVAudioFile alloc] initForReading:url error:&ferr];
    if (!f) return -1;
    AVAudioFormat *fmt = f.processingFormat;
    AVAudioPCMBuffer *buf = [[AVAudioPCMBuffer alloc] initWithPCMFormat:fmt frameCapacity:8192];
    while (YES) {
        [buf setFrameLength:0];
        NSError *rerr = nil;
        if (![f readIntoBuffer:buf error:&rerr] || buf.frameLength == 0) break;
        [g_req appendAudioPCMBuffer:buf];
        // 实时节奏：按本缓冲时长 sleep（识别器不收瞬时灌包）
        usleep((useconds_t)(buf.frameLength / fmt.sampleRate * 1e6));
    }
    [g_req endAudio];
    return 1;
}

/** 读取当前转写（调用方立即拷贝；UTF-8，无则空串） */
const char *onethu_speech_poll(void) {
    if (!g_text) return "";
    @synchronized(g_text) {
        return [g_text UTF8String];
    }
}

/** 停止（最终文本仍可由 poll 拿一次；再次 start 前） */
void onethu_speech_stop(void) {
    if (@available(macOS 10.15, *)) {
        if (g_engine != nil) {
            [g_engine stop];
            [[g_engine inputNode] removeTapOnBus:0];
        }
        if (g_req != nil) [g_req endAudio]; // 尽快产出最终结果
        g_engine = nil; g_req = nil; g_rec = nil;
        g_running = NO;
    }
}
