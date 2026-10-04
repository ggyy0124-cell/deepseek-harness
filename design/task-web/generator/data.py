"""Sample data shared by every artboard, shaped after the /api/task/v1 DTOs.

Definitions follow definitionSchema (no description field exists, so rows are
built from config); runs follow runSchema (no title field exists, so a run is
named from its definition title plus business key or trigger time).
The business plugins are the ones planned in the Task Profile proposal.
"""

DEFS = {
    'zentao.defects': dict(title='禅道缺陷轮询', short='禅道', kind='polling', sched='每 10 分钟轮询', next='今天 14:20',
                           enabled=True, installed=True, code='1.4.2', rev=7, schema=2, icon='Refresh', runs=342),
    'meegle.requirements': dict(title='Meegle 需求轮询', short='Meegle', kind='polling', sched='每 15 分钟轮询', next='今天 14:25',
                                enabled=True, installed=True, code='0.9.0', rev=3, schema=1, icon='Refresh', runs=118),
    'report.weekly': dict(title='周报', short='周报', kind='scheduled', sched='每周五 17:00 · Asia/Shanghai', next='10-02 周五 17:00',
                          enabled=True, installed=True, code='1.1.0', rev=4, schema=1, icon='AlarmClock', runs=21),
    'report.worklog': dict(title='工时填报', short='工时', kind='scheduled', sched='工作日 18:30 · Asia/Shanghai', next=None,
                           enabled=False, installed=True, code='1.0.3', rev=2, schema=1, icon='AlarmClock', runs=64,
                           reason='schedule evaluation failed (RangeError)'),
    'review.performance': dict(title='绩效自评', short='绩效', kind='manual', sched='手动触发', next=None,
                               enabled=True, installed=True, code='0.3.1', rev=1, schema=0, icon='Play', runs=3),
    'report.daily': dict(title='日报', short='日报', kind='scheduled', sched='工作日 19:00 · Asia/Shanghai', next=None,
                         enabled=False, installed=False, code='0.6.0', rev=5, schema=1, icon='AlarmClock', runs=23),
}

# id, definition, kind, businessKey, status, createdAt, updatedAt, parentRunId, cleanup, reason
RUNS = [
    ('7c1e9a42', 'zentao.defects', 'ordinary', 'BUG-4821', 'running', '14:02', '14:11', '3b9d0f17', 'pending', None),
    ('a4f06c3d', 'meegle.requirements', 'ordinary', 'REQ-1287', 'waiting_input', '13:40', '14:08', 'e2c4b8a1', 'pending', '等待确认实现方案'),
    ('4b8e1d07', 'zentao.defects', 'ordinary', 'BUG-4826', 'running', '13:51', '14:09', '5e9c2a44', 'pending', None),
    ('6a3c9f52', 'meegle.requirements', 'ordinary', 'REQ-1291', 'running', '13:31', '14:07', 'e2c4b8a1', 'pending', None),
    ('0e6a9b14', 'zentao.defects', 'ordinary', 'BUG-4833', 'provisioning', '14:01', '14:01', '3b9d0f17', 'pending', None),
    ('c81f2a55', 'zentao.defects', 'ordinary', 'BUG-4830', 'queued', '14:01', '14:01', '3b9d0f17', 'pending', None),
    ('91d7c3e8', 'meegle.requirements', 'ordinary', 'REQ-1290', 'waiting_retry', '13:52', '14:05', 'e2c4b8a1', 'pending', '外部服务返回 503，14:15 重试（第 2 / 5 次）'),
    ('8e3f5b21', 'zentao.defects', 'ordinary', 'BUG-4799', 'cancelling', '13:15', '14:10', '5e9c2a44', 'pending', '用户请求取消'),
    ('5d2b7e90', 'report.weekly', 'scheduled', None, 'blocked', '09-26 17:00', '09-26 17:03', None, 'pending', '凭据 WEEKLY_REPORT_TOKEN 未配置'),
    ('3b9d0f17', 'zentao.defects', 'polling', None, 'succeeded', '14:00', '14:01', None, 'complete', None),
    ('e2c4b8a1', 'meegle.requirements', 'polling', None, 'succeeded', '13:30', '13:31', None, 'complete', None),
    ('f3a8d261', 'zentao.defects', 'ordinary', 'BUG-4802', 'succeeded', '10:12', '11:47', '9a0c7e33', 'complete', None),
    ('2c5e8f07', 'meegle.requirements', 'ordinary', 'REQ-1285', 'blocked', '09:31', '10:26', '6f1b2d90', 'blocked', 'resource cleanup failed; retry cleanup after repair'),
    ('b7c2e4f9', 'review.performance', 'manual', None, 'succeeded', '09-29 20:05', '09-29 20:31', None, 'complete', None),
    ('d6b41a9c', 'zentao.defects', 'ordinary', 'BUG-4790', 'cancelled', '09-29 16:20', '09-29 16:41', '1c7e5a08', 'complete', None),
]

RUN_BY_ID = {r[0]: r for r in RUNS}

# Run outcome: the terminal decision recorded when settlement begins, kept through cleanup.
OUTCOMES = {'8e3f5b21': 'cancelled', '3b9d0f17': 'succeeded', 'e2c4b8a1': 'succeeded', 'f3a8d261': 'succeeded',
            '2c5e8f07': 'failed', 'b7c2e4f9': 'succeeded', 'd6b41a9c': 'cancelled'}

# Which artboard opens a given run in the clickable prototype.
RUN_LINK = {
    '7c1e9a42': 'RunDetail.dc.html',
    'a4f06c3d': 'RunInteraction.dc.html',
    '5d2b7e90': 'RunBlocked.dc.html',
    '4b8e1d07': 'Inbox.dc.html',
    '6a3c9f52': 'Inbox.dc.html',
    '3b9d0f17': 'RunPoll.dc.html',
    'f3a8d261': 'RunResult.dc.html',
    '2c5e8f07': 'RunCleanup.dc.html',
}


def run_title(r):
    d = DEFS[r[1]]
    if r[3]:
        return f'{r[3]}'
    return f'{d["title"]} · {r[5]}'


def run_link(r):
    return RUN_LINK.get(r[0], 'Runs.dc.html')


# Runs without terminalAt, including the cleanup-blocked run whose outcome is already recorded.
ACTIVE = ['7c1e9a42', 'a4f06c3d', '4b8e1d07', '6a3c9f52', '5d2b7e90', '0e6a9b14', 'c81f2a55', '91d7c3e8', '8e3f5b21', '2c5e8f07']
