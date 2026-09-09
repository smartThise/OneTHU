// 寻迹：macOS 原生一次性定位（同步包装 CoreLocation）。
// 背景：tauri-plugin-geolocation 桌面端是返回 (0,0) 的 stub（desktop.rs），
// 无法使用；此桥供 tauri 命令 macos_location 调用，移动端仍走官方插件。
//
// 返回码：1 成功 | 0 超时/失败 | -1 系统定位服务关闭 | -2 权限被拒
// 线程模型：在调用线程上建 manager 并泵该线程 runloop（CoreLocation 标准同步用法），
// 由 spawn_blocking 调起，不占主线程。
#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

@interface OnethuLocator : NSObject <CLLocationManagerDelegate>
@property (nonatomic, strong) CLLocationManager *mgr;
@property (nonatomic, assign) BOOL done;
@property (nonatomic, assign) double lat;
@property (nonatomic, assign) double lng;
@property (nonatomic, assign) double acc;
@property (nonatomic, assign) int status;
@end

@implementation OnethuLocator
- (void)locationManager:(CLLocationManager *)m didUpdateLocations:(NSArray<CLLocation *> *)ls {
    CLLocation *l = ls.lastObject;
    if (l && !self.done) {
        self.lat = l.coordinate.latitude;
        self.lng = l.coordinate.longitude;
        self.acc = l.horizontalAccuracy;
        self.status = 1;
        self.done = YES;
    }
}
- (void)locationManager:(CLLocationManager *)m didFailWithError:(NSError *)e {
    if (!self.done) {
        self.status = ([e.domain isEqualToString:kCLErrorDomain] && e.code == kCLErrorDenied) ? -2 : 0;
        self.done = YES;
    }
}
@end

int onethu_location(double *lat, double *lng, double *acc, double timeoutSec) {
    if (![CLLocationManager locationServicesEnabled]) return -1;
    if ([CLLocationManager authorizationStatus] == kCLAuthorizationStatusDenied) return -2;

    OnethuLocator *loc = [[OnethuLocator alloc] init];
    loc.mgr = [[CLLocationManager alloc] init];
    loc.mgr.delegate = loc;
    loc.mgr.desiredAccuracy = kCLLocationAccuracyHundredMeters;
    [loc.mgr requestLocation]; // 未授权时触发系统授权窗（Info.plist 用途串）

    NSDate *limit = [NSDate dateWithTimeIntervalSinceNow:timeoutSec];
    while (!loc.done && [limit timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
    }
    if (!loc.done) return 0; // 超时（首次授权窗没来得及点也会走到这——下次就快了）
    if (loc.status != 1) return loc.status;
    *lat = loc.lat;
    *lng = loc.lng;
    *acc = loc.acc;
    return 1;
}
