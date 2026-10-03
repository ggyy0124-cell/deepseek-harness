"""Verify the generated Task web prototype.

A. Design-canvas format rules (support.js line, closed tags, holes, hints, sizes, links).
B. Design-language consistency with the upstream Web client: every color, radius,
   font size, font family and neutral border width must come from upstream tokens.
C. Completeness: every /api/task/v1 capability and every enumerated value of the
   public DTOs has visible evidence on the artboard that owns it.
D. Clickable-prototype graph: every in-app artboard is reachable from Main.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1] / 'canvas'
REPO = Path(__file__).resolve().parents[3]
UPSTREAM_CSS = [REPO / 'packages/client/ui-theme/src/styles/design-platform.css',
                REPO / 'packages/client/ui-theme/src/styles/gradient-shadow-text.css']

canvas = json.load(open(f'{PROJECT}/canvas.json'))
DOCS = {name: open(f'{PROJECT}/{name}').read() for name in canvas['boards']}
failures = []
passes = 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        failures.append(msg)


# ------------------------------------------------------------------ A. format
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class Balance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors, self.tags = [], [], []
        self.controls, self.unnamed = [], []

    def handle_data(self, data):
        if data.strip():
            for c in self.controls:
                c[1] = True

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append((tag, a))
        if tag in ('button', 'a'):
            self.controls.append([tag, bool(a.get('aria-label')), a])
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        if tag not in VOID and tag not in ('path', 'rect', 'circle'):
            self.errors.append(f'self-closed <{tag}/>')

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in ('button', 'a') and self.controls:
            c = self.controls.pop()
            if not c[1]:
                self.unnamed.append(c[2].get('href') or c[2].get('onclick') or c[2].get('style', '')[:40])
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f'unexpected </{tag}> (open: {self.stack[-3:]})')
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
            return
        self.stack.pop()


HOLE = re.compile(r'\{\{([^}]*)\}\}')
PATH = re.compile(r'^\s*(?:[A-Za-z_$][\w$]*(?:\.[\w$]+)*|true|false|-?\d+(?:\.\d+)?)\s*$')
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿]')

for name, doc in DOCS.items():
    b = canvas['boards'][name]
    check('<script src="./support.js"></script>' in doc, f'{name}: support.js line')
    check(doc.count('<x-dc>') == 1 and doc.count('</x-dc>') == 1, f'{name}: one x-dc')
    check('<script type="text/x-dc" data-dc-script' in doc and 'class Component extends DCLogic' in doc, f'{name}: logic block')
    m = re.search(r"data-props='([^']*)'", doc)
    check(m is not None, f'{name}: data-props')
    if m:
        props = json.loads(html.unescape(m.group(1)))
        check(props.get('$preview') == {'width': b['w'], 'height': b['h']}, f'{name}: $preview matches board {b["w"]}x{b["h"]}')
    tpl = doc[doc.index('<x-dc>') + 6: doc.rindex('</x-dc>')]
    p = Balance()
    p.feed(tpl)
    p.close()
    check(not p.errors and not p.stack, f'{name}: balanced tags {p.errors[:3]} {p.stack[-3:]}')
    root = re.search(r'</helmet>\s*<div style="width: (\d+)px; height: (\d+)px', tpl)
    check(root is not None and (int(root.group(1)), int(root.group(2))) == (b['w'], b['h']), f'{name}: root size equals board')
    bad = [h for h in HOLE.findall(tpl) if not PATH.match(h)]
    check(not bad, f'{name}: non-path holes {bad[:3]}')
    for tag, attrs in p.tags:
        if tag == 'sc-for':
            check('hint-placeholder-count' in attrs, f'{name}: sc-for hint')
        if tag == 'sc-if':
            check('hint-placeholder-val' in attrs, f'{name}: sc-if hint')
        if tag in ('iframe', 'object', 'embed'):
            failures.append(f'{name}: forbidden <{tag}>')
        if tag == 'a':
            href = attrs.get('href', '')
            if HOLE.fullmatch(href.strip()):
                continue
            check(href.endswith('.dc.html') and href in canvas['boards'], f'{name}: link target {href!r}')
        if tag == 'button' and not attrs.get('aria-label'):
            pass
    for target in re.findall(r'"href": "([A-Za-z]+\.dc\.html)"', doc):
        check(target in canvas['boards'], f'{name}: bound link target {target!r}')
    check(not p.unnamed, f'{name}: controls without an accessible name {p.unnamed[:3]}')
    check(not EMOJI.search(tpl), f'{name}: no emoji')
    check('data:' not in tpl and 'http://' not in re.sub(r'http://127\.0\.0\.1:3081/api/task/v1', '', tpl) and 'https://' not in tpl.replace('https://zentao.example.com', ''),
          f'{name}: no external or data URLs')


# ------------------------------------------------------------------ B. upstream tokens
def norm(color):
    color = color.strip().lower()
    if color.startswith('#'):
        h = color[1:]
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    inner = color[color.index('(') + 1: color.rindex(')')].replace('/', ' ').replace(',', ' ').split()
    r, g, bl = (int(float(x)) for x in inner[:3])
    a = 1.0
    if len(inner) > 3:
        a = float(inner[3][:-1]) / 100 if inner[3].endswith('%') else float(inner[3])
    return (r, g, bl, round(a, 3))


COLOR = re.compile(r'rgba?\([^)]*\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b')
allowed = set()
for css in UPSTREAM_CSS:
    for c in COLOR.findall(open(css).read()):
        allowed.add(norm(c))
# color-mix(<token> N%, transparent) tints used by upstream Tag tones, and the two
# computed label-deep-diving mixes; each is derived from an upstream token above.
derived = {'rgba(65, 118, 230, 0.1)': 'info tag = business-primary 10%', 'rgba(122, 170, 255, 0.1)': 'info tag (dark)',
           'rgba(34, 197, 94, 0.1)': 'success tag 10%', 'rgba(245, 158, 11, 0.12)': 'warning tag 12%',
           'rgba(236, 19, 19, 0.1)': 'danger tag 10%', 'rgba(242, 90, 90, 0.1)': 'danger tag (dark)',
           'rgb(52, 94, 186)': 'label-deep-diving light', 'rgb(125, 154, 223)': 'label-deep-diving dark'}
for c in derived:
    allowed.add(norm(c))
RADII = {'0', '0px', '4px', '8px', '12px', '16px', '20px', '28px', '50%', '999px'}
FONT_SIZES = {10, 11, 12, 13, 14, 15, 16, 18, 20, 24}
off_palette, off_radius, off_size, off_font, off_border = {}, {}, {}, {}, {}
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"
NEUTRAL_BORDERS = {norm(x) for x in ['rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.1)', 'rgba(0, 0, 0, 0.12)', 'rgba(0, 0, 0, 0.16)',
                                     'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.2)']}
for name, doc in DOCS.items():
    tpl = doc[doc.index('<x-dc>'):]
    tpl = tpl[:tpl.index('<script type="text/x-dc"')] + doc[doc.index('<script type="text/x-dc"'):]
    for c in COLOR.findall(tpl):
        if norm(c) not in allowed:
            off_palette.setdefault(c, set()).add(name)
    for r in re.findall(r'border-radius:\s*([^;"]+)', tpl):
        for part in r.split():
            if part not in RADII and '{{' not in part:
                off_radius.setdefault(part, set()).add(name)
    for fs in re.findall(r'font-size:\s*(\d+)px', tpl):
        if int(fs) not in FONT_SIZES:
            off_size.setdefault(fs, set()).add(name)
    for ff in re.findall(r'font-family:\s*([^;"]+)', tpl):
        ff = html.unescape(ff).strip()
        if ff not in (FONT, MONO, 'inherit'):
            off_font.setdefault(ff[:40], set()).add(name)
    for w, style, col in re.findall(r'border(?:-top|-bottom|-left|-right)?:\s*([\d.]+)px (solid|dashed) ([^;"]+)', tpl):
        c = col.strip()
        if c.startswith('rgb') and norm(c) in NEUTRAL_BORDERS and style == 'solid' and w != '0.5' and not (w == '1' and norm(c) == norm('rgba(0, 0, 0, 0.1)')):
            off_border.setdefault(f'{w}px {c}', set()).add(name)
check(not off_palette, f'off-palette colors: {off_palette}')
check(not off_radius, f'off-scale radii: {off_radius}')
check(not off_size, f'off-scale font sizes: {off_size}')
check(not off_font, f'foreign font stacks: {off_font}')
check(not off_border, f'neutral borders wider than 0.5px: {off_border}')

# ------------------------------------------------------------------ C. completeness
def has(board, *needles):
    text = DOCS[board]
    for n in needles:
        check(n in text, f'coverage: {board} lacks {n!r}')


COVERAGE = {
    # transport / auth
    'POST /auth/exchange': ('Login.dc.html', ['启动链接', '60 秒', '一次性']),
    'launch link (CLI)': ('Login.dc.html', ['dsh --profile task --launch-link', '过期时间']),
    'GET /auth/session (expiry)': ('Login.dc.html', ['浏览器会话已结束']),
    'POST /auth/logout': ('Settings.dc.html', ['退出登录']),
    'GET /ready + /health': ('Login.dc.html', ['任务服务正在恢复']),
    'readiness in settings': ('Settings.dc.html', ['服务状态', '就绪']),
    'GET /openapi.json': ('Settings.dc.html', ['openapi.json']),
    'device tokens (CLI)': ('Settings.dc.html', ['--token-create', '--token-revoke']),
    'backup/restore (CLI)': ('Settings.dc.html', ['--backup']),
    'time display UTC': ('Settings.dc.html', ['UTC']),
    # diagnostics
    'GET /diagnostics scheduler': ('Diagnostics.dc.html', ['调度器', '运行中']),
    'diagnostics permits': ('Diagnostics.dc.html', ['执行名额', '3 / 4']),
    'diagnostics runs': ('Diagnostics.dc.html', ['执行总数', '进行中 10', '已结束 561']),
    'diagnostics queue': ('Diagnostics.dc.html', ['排队', '最早']),
    'diagnostics inputs/errors': ('Diagnostics.dc.html', ['待处理输入', '恢复错误', '清理失败']),
    'diagnostics outbox': ('Diagnostics.dc.html', ['待投递会话屏障']),
    'diagnostics resources': ('Diagnostics.dc.html', ['资源占用', '容量', '占用的执行']),
    'diagnostics retirements': ('Diagnostics.dc.html', ['插件退役', '已退役']),
    'diagnostics storage': ('Diagnostics.dc.html', ['存储', '可用']),
    'GET /events (task SSE)': ('Diagnostics.dc.html', ['实时事件', '游标', 'stage.started', 'run.reserved']),
    'task SSE driven refresh': ('Runs.dc.html', ['实时事件', '刷新列表']),
    'SSE reconnect + repair': ('Components.dc.html', ['实时事件已断开', '正在重新连接', '已补齐错过的事件']),
    # definitions
    'GET /definitions installed+historical': ('Definitions.dc.html', ['已安装', '已卸载', '未安装', '插件代码不可用']),
    'definition availability blocked + reason': ('Definitions.dc.html', ['调度受阻', 'schedule evaluation failed (RangeError)', '重新启用']),
    'PUT /definitions/{id}/enabled': ('Definitions.dc.html', ['role="switch"', '已暂停']),
    'GET /definitions/{id}': ('Definition.dc.html', ['代码 v1.4.2', '配置修订 7', '表单版本 2', '下次轮询']),
    'schedule polling': ('Definition.dc.html', ['轮询间隔', '不会与下一次重叠']),
    'schedule scheduled': ('Schedule.dc.html', ['Cron 表达式', '时区', 'Asia/Shanghai']),
    'misfire all/coalesce/skip': ('Schedule.dc.html', ['全部补跑', '合并为一次', '跳过']),
    'overlap queue/allow': ('Schedule.dc.html', ['排队', '允许并行']),
    'config concurrency/preset/permission/model/workspace': ('Definition.dc.html', ['并发上限', 'Agent 预设', '权限预设', '模型', '工作目录']),
    'GET /catalog selectors': ('Definition.dc.html', ['coding · 编码', '工作区内修改', 'DeepSeek-V4-Flash']),
    'businessConfigSchema form': ('Definition.dc.html', ['业务配置', '禅道地址', '严重程度']),
    'schema v0 JSON editor': ('Definition.dc.html', ['JSON', '表单版本 0']),
    'POST …/config/options': ('Definition.dc.html', ['选项由插件实时提供', '刷新选项']),
    'POST …/config/check': ('Definition.dc.html', ['检查配置', '插件返回 2 条提示']),
    'PUT …/config revision': ('Definition.dc.html', ['修订 8', '只影响之后的触发']),
    '409 revision_conflict': ('Conflict.dc.html', ['配置已被更新', '修订 8', '被拒绝', '重新应用']),
    'credential reference in config': ('Definition.dc.html', ['ZENTAO_TOKEN', '已配置', '替换']),
    'credential missing': ('Schedule.dc.html', ['WEEKLY_REPORT_TOKEN', '未配置']),
    'GET/PUT /credentials/{reference}': ('Settings.dc.html', ['已配置', '未配置', '只读', '输入新值', '值不会再次显示']),
    'GET /credentials': ('Settings.dc.html', ['已安装任务当前配置引用']),
    'POST/GET …/retirement': ('Retire.dc.html', ['退役', '关闭准入', '不能撤销', '开始退役']),
    'POST …/runs manual trigger': ('Trigger.dc.html', ['手动触发', '考核周期', '重复提交同一请求不会创建重复执行']),
    # runs
    'GET /runs filters': ('Runs.dc.html', ['全部任务', '业务键（精确匹配）', '最近 7 天', '普通执行', '更多状态']),
    'GET /runs cursor pagination': ('Runs.dc.html', ['加载更多', '从第一页重新加载']),
    'GET /runs/{id} fields': ('RunDetail.dc.html', ['执行 ID', '会话 ID', '业务键', '配置修订', '代码版本', '执行修订', '计划重试', '结束', '来源']),
    'run reason': ('RunInteraction.dc.html', ['原因', '等待确认实现方案']),
    'GET …/transcript text/reasoning/tool': ('RunDetail.dc.html', ['思考', '读取文件', '运行命令', '退出码 1']),
    'transcript unsupported block': ('RunResult.dc.html', ['暂不支持显示的内容']),
    'GET …/events (session SSE)': ('RunDetail.dc.html', ['会话流已连接', 'Agent 正在工作']),
    'POST …/inputs': ('RunDetail.dc.html', ['作为业务输入持久保存']),
    'wake blocked run': ('RunBlocked.dc.html', ['已阻塞', '补充一条输入', '唤醒执行']),
    'POST …/cleanup + recorded outcome': ('RunCleanup.dc.html', ['清理受阻', '结论', '重试清理', '只执行清理', '已受理重试清理', '不再接受新附件']),
    'cleanup-blocked attention': ('Main.dc.html', ['清理受阻', 'RunCleanup.dc.html']),
    'GET …/interactions + respond business': ('RunInteraction.dc.html', ['业务确认', '修订 3', '提交回复', '过期']),
    'tool approval': ('Inbox.dc.html', ['工具审批', '允许一次', '拒绝']),
    'agent question': ('Inbox.dc.html', ['Agent 提问', '提交回答']),
    '409 stale_interaction': ('Inbox.dc.html', ['修订 4', '查看最新']),
    'POST …/cancellation 202': ('RunDetail.dc.html', ['取消执行']),
    'cancellation accepted feedback': ('Components.dc.html', ['已受理取消', '取消中']),
    'result document task-result/v1': ('RunResult.dc.html', ['task-result/v1', 'markdown', 'table', 'diff', 'json', 'image · file']),
    'terminal read-only': ('RunResult.dc.html', ['会话只读', '不能再发送输入']),
    'attachments list/upload/download': ('RunDetail.dc.html', ['选择文件', '50 MB', '下载']),
    'attachments after termination + Range': ('RunResult.dc.html', ['不能再上传附件', '断点续传']),
    'session-attachment chip': ('RunDetail.dc.html', ['login-timeout.log']),
    '409 session_unavailable': ('Components.dc.html', ['会话尚未就绪']),
    'lineage parent/children': ('RunPoll.dc.html', ['派发的普通执行', '不会影响它们', '关联到仍未结束的执行']),
    'ordinary run source': ('RunDetail.dc.html', ['轮询执行 3b9d0f17']),
    'error codes': ('Components.dc.html', ['revision_conflict', 'stale_interaction', 'read_only', 'run_readonly', 'invalid_state', 'idempotency_conflict',
                                           'not_found', 'invalid_configuration', 'authentication_required', 'csrf_rejected', 'session_unavailable', 'cursor_stale', 'unavailable (503)']),
    'dark theme': ('OverviewDark.dc.html', ['rgb(21, 21, 23)']),
}
for cap, (board, needles) in COVERAGE.items():
    has(board, *needles)

# every DTO enum value has a visible label on the component sheet
STATUS_ZH = ['准备中', '排队中', '运行中', '等待输入', '等待重试', '已阻塞', '恢复中', '取消中', '已成功', '已失败', '已取消']
STATUS_API = ['provisioning', 'queued', 'running', 'waiting_input', 'waiting_retry', 'blocked', 'recovering', 'cancelling', 'succeeded', 'failed', 'cancelled']
has('Components.dc.html', *STATUS_ZH, *STATUS_API)
has('Components.dc.html', '手动', '轮询', '定时', '普通执行')          # run kind
has('Components.dc.html', '待清理', '清理受阻', '已清理')              # cleanup
has('Components.dc.html', '业务确认', '工具审批', 'Agent 提问')        # interaction source
has('Components.dc.html', '退役中', '退役受阻', '已退役')              # retirement state
has('Components.dc.html', '任务可用性', '已启用', '已暂停', '调度受阻', '未安装')  # definition availability
has('Components.dc.html', '执行结论 outcome')                          # run outcome

# ------------------------------------------------------------------ D. prototype graph
links = {n: set(re.findall(r'href="([A-Za-z]+\.dc\.html)"', d)) | set(re.findall(r'"href": "([A-Za-z]+\.dc\.html)"', d)) for n, d in DOCS.items()}
seen, todo = set(), ['Main.dc.html']
while todo:
    n = todo.pop()
    if n in seen:
        continue
    seen.add(n)
    todo.extend(links[n] - seen)
unreached = set(DOCS) - seen - {'Login.dc.html', 'Components.dc.html', 'Conflict.dc.html'}
check(not unreached, f'unreachable in prototype: {sorted(unreached)}')

print(f'checks passed: {passes}, failed: {len(failures)}')
print(f'capabilities covered: {len(COVERAGE)} · artboards: {len(DOCS)} · reachable from Main: {len(seen)}')
print(f'upstream colors allowed: {len(allowed)}')
for f in failures:
    print('FAIL', f)
sys.exit(1 if failures else 0)
