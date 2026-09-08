#!/usr/bin/env bash
# OneTHU CalDAV 探针 —— 摸清清华邮箱 CalDAV 能力边界
# 用法:
#   CALUSER='完整邮箱地址' CALPASS='客户端专用密码' bash tools/caldav-probe.sh
# 可选: --mkcalendar  追加测试「创建独立日历集合」(账号里会建 OneTHU-Sync, 可删)
#       --put          追加测试「写入+删除一个测试日程」
# 凭据只走环境变量, 不进 argv, 不回显。

set -uo pipefail

HOST="https://mails.tsinghua.edu.cn"
BASE="$HOST/.well-known/caldav"
USER="${CALUSER:?请设置 CALUSER=完整邮箱地址}"
PASS="${CALPASS:?请设置 CALPASS=客户端专用密码}"
MKCAL=0; PUT=0
for a in "$@"; do
  [ "$a" = "--mkcalendar" ] && MKCAL=1
  [ "$a" = "--put" ] && PUT=1
done

CURL=(curl -sS --max-time 20 --user "$USER:$PASS")

hdr() { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n' "$*"; }
xmlhdr() { printf '<?xml version="1.0" encoding="utf-8"?>%s' "$1"; }

# ---------- 1. OPTIONS: 服务器能力 ----------
hdr "1. OPTIONS 能力"
"${CURL[@]}" -i -X OPTIONS "$BASE" | tr -d '\r' | grep -iE "^(HTTP|DAV|Allow|WWW-Auth)" || echo "(无响应头)"

# ---------- 2. well-known 重定向发现 ----------
hdr "2. well-known 发现 (跟随重定向, 揭示真实 DAV 根)"
PF_MIN=' <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:current-user-principal/></D:prop></D:propfind>'
BODY=$(xmlhdr "$PF_MIN")
OUT=$("${CURL[@]}" -i -L -X PROPFIND -H "Depth: 0" -H "Content-Type: application/xml" -d "$BODY" "$BASE" | tr -d '\r')
echo "$OUT" | grep -iE "^(HTTP|Location)" | head -10
FINAL=$("${CURL[@]}" -o /dev/null -w '%{url_effective}' -L -X PROPFIND -H "Depth: 0" -H "Content-Type: application/xml" -d "$BODY" "$BASE")
echo "final-url: $FINAL"
echo "$OUT" | awk 'buf{print} /^\r?$/{buf=1}' > /tmp/caldav_probe_2.xml
RESP=$(cat /tmp/caldav_probe_2.xml)
echo "$RESP" | head -25

PRINCIPAL=$(echo "$RESP" | sed -n 's/.*<D:href>\([^<]*\)<\/D:href>.*/\1/p' | head -1)
echo "principal-href: ${PRINCIPAL:-<未取到>}"

absurl() { case "$1" in http*) printf '%s' "$1";; //*) printf 'https:%s' "$1";; /*) printf '%s%s' "$HOST" "$1";; *) printf '%s' "$2";; esac; }

# ---------- 3. principal 属性 ----------
hdr "3. principal → calendar-home-set"
PURL=$(absurl "${PRINCIPAL:-}" "$FINAL")
BODY=$(xmlhdr ' <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><C:calendar-home-set/></D:prop></D:propfind>')
"${CURL[@]}" -X PROPFIND -H "Depth: 0" -H "Content-Type: application/xml" -d "$BODY" "$PURL" > /tmp/caldav_probe_3.xml
head -25 /tmp/caldav_probe_3.xml
HOME=$(sed -n 's/.*<D:href>\([^<]*\)<\/D:href>.*/\1/p' /tmp/caldav_probe_3.xml | tail -1)
echo "calendar-home: ${HOME:-<未取到>}"

# ---------- 4. 日历集合清单 ----------
hdr "4. 日历集合清单 (Depth:1)"
HURL=""
if [ -n "${HOME:-}" ]; then
  HURL=$(absurl "$HOME" "$FINAL")
  BODY=$(xmlhdr ' <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/><D:getctag/><D:sync-token/><D:getetag/></D:prop></D:propfind>')
  "${CURL[@]}" -X PROPFIND -H "Depth: 1" -H "Content-Type: application/xml" -d "$BODY" "$HURL" > /tmp/caldav_probe_4.xml
  head -80 /tmp/caldav_probe_4.xml
else
  echo "(跳过: 没有 calendar-home-set)"
fi

# ---------- 5. sync-collection 增量能力 (RFC 6578) ----------
hdr "5. sync-collection 增量同步测试"
if [ -n "$HURL" ]; then
  BODY=$(xmlhdr ' <C:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:sync-token/><D:prop><D:getetag/></D:prop></C:sync-collection>')
  "${CURL[@]}" -i -X REPORT -H "Depth: 1" -H "Content-Type: application/xml" -d "$BODY" "$HURL" | tr -d '\r' | grep -iE "^(HTTP|Location)" | head -5
  echo "(207+sync-token=支持增量; 403/404=不支持, 退回 CTAG 全量比对)"
fi

# ---------- 6. MKCALENDAR ----------
if [ "$MKCAL" = 1 ] && [ -n "$HURL" ]; then
  hdr "6. MKCALENDAR 创建独立集合 OneTHU-Sync"
  BODY=$(xmlhdr ' <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>OneTHU-Sync</D:displayname></D:prop></D:set></C:mkcalendar>')
  "${CURL[@]}" -i -X MKCALENDAR -H "Content-Type: application/xml" -d "$BODY" "$HURL/OneTHU-Sync/" | tr -d '\r' | grep -iE "^(HTTP|Location)" | head -5
fi

# ---------- 7. PUT/DELETE 写测试 ----------
if [ "$PUT" = 1 ] && [ -n "$HURL" ]; then
  hdr "7. 写入 + 删除测试日程"
  NOW=$(date -u +%Y%m%dT%H%M%SZ)
  EV="BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OneTHU//Probe//CN
BEGIN:VEVENT
UID:onethu-probe-$(date +%s)@onethu
DTSTAMP:$NOW
DTSTART;TZID=Asia/Shanghai:$(date -v+1H +%Y%m%dT%H%M00)
DTEND;TZID=Asia/Shanghai:$(date -v+2H +%Y%m%dT%H%M00)
SUMMARY:OneTHU 探针测试事件(可删)
END:VEVENT
END:VCALENDAR"
  "${CURL[@]}" -i -X PUT -H "Content-Type: text/calendar; charset=utf-8" -d "$EV" "$HURL/onethu-probe.ics" | tr -d '\r' | grep -iE "^(HTTP|ETag|Location)" | head -5
  echo "--- GET 回读 ---"
  "${CURL[@]}" -X GET "$HURL/onethu-probe.ics" | head -12
  echo "--- DELETE 清理 ---"
  "${CURL[@]}" -i -X DELETE "$HURL/onethu-probe.ics" | tr -d '\r' | grep -iE "^HTTP" | head -3
fi

hdr "探针结束。把以上完整输出贴回即可(不含任何密码)。"
