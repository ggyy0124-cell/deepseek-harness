"""Build every artboard plus project/canvas.json for the Design canvas."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import base  # noqa: E402
import screens_a as A  # noqa: E402
import screens_b as B  # noqa: E402

PROJECT = base.CANVAS
# Fixed creation stamp keeps rebuilt canvas.json byte-identical.
CREATED = '2026-09-30T07:56:14Z'

ROWS = [
    ('row1', '01 接入与总览', [('Login', A.login, 900, '连接任务服务'), ('Main', A.overview, 900, '概览'),
                             ('OverviewDark', lambda: A.overview(True), 900, '概览 · 深色'), ('Diagnostics', A.diagnostics, 1100, '诊断')],
     'blue', '接口：dsh --profile task --launch-link（终端输出一次性链接，密钥在 #launch= 片段中，不进入 HTTP 请求）· POST /auth/exchange · GET /auth/session（含会话过期时间）· POST /auth/logout · GET /ready · GET /diagnostics · GET /definitions · GET /runs · GET /interactions · GET /events（任务 SSE：先收到 ready 游标再取 REST 快照，断线后用 Last-Event-ID 续传）'),
    ('row2', '02 任务定义', [('Definitions', A.definitions, 900, '任务'), ('Definition', A.definition, 1940, '任务配置 · 轮询'),
                          ('Schedule', A.schedule, 1580, '任务配置 · 定时'), ('Conflict', A.conflict, 900, '配置冲突 409'),
                          ('Retire', A.retire, 900, '插件退役'), ('Trigger', A.trigger, 900, '手动触发')],
     'teal', '接口：GET /definitions（availability + reason）· GET /definitions/{id} · PUT …/config（revision + configSchemaVersion）· PUT …/enabled（重新启用会清除调度受阻原因）· POST …/config/check · POST …/config/options · GET /catalog（预设含名称与说明）· POST …/runs（manualInputSchema）· POST/GET …/retirement · GET /credentials · GET/PUT /credentials/{reference}。表单控件由 x-dsh-widget 声明：textarea / credential / options。所有写操作带 Idempotency-Key；浏览器写请求带 X-CSRF-Token。'),
    ('row3', '03 执行', [('Runs', B.runs, 1040, '执行记录'), ('RunDetail', B.run_detail, 900, '执行详情 · 运行中'),
                       ('RunInteraction', B.run_interaction, 1000, '执行详情 · 等待输入'), ('RunResult', B.run_result, 1240, '执行详情 · 已成功'),
                       ('RunBlocked', B.run_blocked, 900, '执行详情 · 已阻塞'), ('RunCleanup', B.run_cleanup, 940, '执行详情 · 清理受阻'),
                       ('RunPoll', B.run_poll, 900, '执行详情 · 轮询与派发')],
     'purple', '接口：GET /runs（definitionId / status 逗号分隔多选 / kind / businessKey / parentRunId / createdFrom–To，游标分页）· GET /runs/{id}（outcome · occurrence · supplementalInputSchema）· GET …/transcript · GET …/events（会话 SSE，独立游标）· POST …/inputs · GET …/interactions · POST …/interactions/{waitId}/responses（revision）· POST …/cancellation（202）· POST …/cleanup（202，只重试受阻的清理，结论不变）· GET/POST …/attachments · GET …/attachments/{id}（Range）· GET …/session-attachments/{sequence}/{index}'),
    ('row4', '04 待处理、设置与规范', [('Inbox', B.inbox, 980, '待处理'), ('Settings', B.settings, 900, '设置'), ('Components', B.components, 2420, '组件与状态')],
     'orange', '待处理来自 GET /interactions（跨执行，按创建时间排序）；409 stale_interaction 时提示重新查看。设置页覆盖连接、凭据（GET /credentials 列出引用，值只写不读）、设备令牌说明与版本信息。组件页列出全部状态取值、错误码与上游令牌。'),
]


def main():
    os.makedirs(PROJECT, exist_ok=True)
    boards, order, notes = {}, [], {}
    y = 0
    files = {}
    for rid, title, items, color, sticky in ROWS:
        x = 0
        row_h = 0
        for name, fn, h, label in items:
            base.set_theme(base.LIGHT)
            doc = fn()
            if isinstance(doc, tuple):
                doc = doc[0]
            doc = doc.replace('Overview.dc.html', 'Main.dc.html')
            fname = f'{name}.dc.html'
            files[fname] = doc
            boards[fname] = {'x': x, 'y': y, 'w': 1440, 'h': h, 'title': label, 'is_interactive': True}
            order.append(fname)
            x += 1440 + 80
            row_h = max(row_h, h)
        notes[rid] = {'x': 0, 'y': y - 260, 'text': title, 'kind': 'title1', 'maxW': x - 80}
        notes[rid + '-api'] = {'x': -640, 'y': y, 'text': sticky, 'w': 560, 'maxH': 520, 'color': color, 'size': 'm'}
        y += row_h + 120 + 260
    # Login has no interactive controls beyond copy; keep the Play badge off it.
    boards['Login.dc.html']['is_interactive'] = False
    boards['Components.dc.html']['is_interactive'] = False
    for fname, doc in files.items():
        with open(f'{PROJECT}/{fname}', 'w') as f:
            f.write(doc)
    canvas = {
        'v': 3,
        'createdOnFiles': {'v': 1, 'at': CREATED},
        'title': 'DSH Task Web 原型',
        'launch': {'view': 'canvas'},
        'pages': [],
        'boards': boards,
        'order': order,
        'notes': notes,
        'designSystems': [],
    }
    with open(f'{PROJECT}/canvas.json', 'w') as f:
        json.dump(canvas, f, ensure_ascii=False, indent=1)
        f.write('\n')
    total = sum(len(d.encode()) for d in files.values())
    print(f'{len(files)} artboards, {total/1024:.0f} KiB')


if __name__ == '__main__':
    main()
