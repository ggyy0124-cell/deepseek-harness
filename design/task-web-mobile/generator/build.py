"""Build the phone-width Task Web artboards plus canvas/canvas.json for the Design canvas.

Tokens, icons, controls and sample data come from the desktop prototype generator in design/task-web/generator,
so both prototypes share one design language and one data set.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'task-web' / 'generator'))
import base  # noqa: E402
from base import attr, btn, card, esc, icon, mark, notice, status_mark, status_tag, switch, t, tag, KIND, SOURCE  # noqa: E402
from data import ACTIVE, DEFS, RUN_BY_ID, RUNS  # noqa: E402

CANVAS = HERE.parent / 'canvas'
# Fixed creation stamp keeps rebuilt canvas.json byte-identical.
CREATED = '2026-10-10T11:34:17Z'
W, H = 390, 844
TOP, TABS = 56, 64

TAB_ITEMS = [
    ('overview', '概览', 'Gauge', 'Main.dc.html'),
    ('defs', '任务', 'ListPen', 'Definitions.dc.html'),
    ('runs', '执行记录', 'Queue', 'Runs.dc.html'),
    ('inbox', '待处理', 'Question', 'Inbox.dc.html'),
    ('diag', '诊断', 'Data', 'Main.dc.html'),
]
RUN_LINK = {'7c1e9a42': 'RunDetail.dc.html', 'a4f06c3d': 'Inbox.dc.html'}


def run_name(r):
    return r[3] if r[3] else f'{DEFS[r[1]]["title"]} · {r[5]}'


def touch_btn(name, aria, href=None, onclick=None, color=None):
    """44 px icon button: the minimum touch target on every phone artboard."""
    c = color or t('label')
    s = (f'box-sizing: border-box; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: none; '
         f'border: 0; border-radius: 12px; background: transparent; color: {c}; padding: 0; cursor: pointer')
    o = f' onClick="{onclick}"' if onclick else ''
    if href:
        return f'<a href="{href}" aria-label="{attr(aria)}"{o} style="{s}">{icon(name, 20, 1.3)}</a>'
    return f'<button type="button" aria-label="{attr(aria)}"{o} style="{s}">{icon(name, 20, 1.3)}</button>'


def top_bar(title, back=None, right='', sub=''):
    """Phone top bar: menu or back on the left, page title, page actions on the right."""
    left = touch_btn('ChevronLeft', '返回', href=back) if back else touch_btn('PanelLeft', '打开导航', href='Drawer.dc.html')
    s = f'<span style="font-size: 12px; line-height: 16px; color: {t("label3")}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{esc(sub)}</span>' if sub else ''
    return (f'<header style="height: {TOP}px; flex: none; box-sizing: border-box; padding: 0 6px; display: flex; align-items: center; gap: 2px; '
            f'border-bottom: 0.5px solid {t("b3")}; background: {t("base")}">{left}'
            f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; padding-left: 2px">'
            f'<h1 style="margin: 0; font-size: 16px; line-height: 22px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{esc(title)}</h1>{s}</div>'
            f'<div style="flex: none; display: flex; align-items: center">{right}</div></header>')


def tab_bar(active):
    """Bottom navigation: the five sections of the desktop sidebar, inbox count as a badge."""
    items = ''
    for key, label, ic, href in TAB_ITEMS:
        on = key == active
        col = t('label') if on else t('label3')
        cur = ' aria-current="page"' if on else ''
        badge = (f'<span style="position: absolute; top: 4px; left: calc(50% + 6px); min-width: 16px; height: 16px; box-sizing: border-box; padding: 0 4px; border-radius: 999px; '
                 f'background: {t("amber")}; color: rgb(255, 255, 255); font-size: 11px; line-height: 16px; font-weight: 500; text-align: center">3</span>') if key == 'inbox' else ''
        items += (f'<a href="{href}"{cur} style="position: relative; flex: 1; min-width: 0; height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; '
                  f'color: {col}; font-size: 11px; line-height: 16px; font-weight: {500 if on else 400}">{icon(ic, 22, 1.3)}<span>{esc(label)}</span>{badge}</a>')
    return (f'<nav aria-label="主导航" style="height: {TABS}px; flex: none; box-sizing: border-box; padding: 0 4px 8px; display: flex; align-items: flex-start; '
            f'border-top: 0.5px solid {t("b3")}; background: {t("sidebar")}">{items}</nav>')


def scroll(content, pad='16px 16px 24px', gap=16):
    return (f'<main style="flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; padding: {pad}; display: flex; flex-direction: column; gap: {gap}px">'
            f'{content}</main>')


def frame(title, body, tab=None):
    content = body + (tab_bar(tab) if tab else '')
    return base.page(title, base.root(content, W, H, 'column'), W, H)


def trigger_btn():
    return touch_btn('Play', '手动触发', href='Trigger.dc.html')


def section(text, right=''):
    return (f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px">'
            f'<h2 style="margin: 0; font-size: 14px; line-height: 22px; font-weight: 500">{esc(text)}</h2>{right}</div>')


def run_card(rid):
    r = RUN_BY_ID[rid]
    d = DEFS[r[1]]
    href = RUN_LINK.get(rid, 'RunDetail.dc.html')
    reason = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(r[9])}</span>' if r[9] else ''
    return (f'<a href="{href}" class="hv" style="box-sizing: border-box; min-height: 64px; padding: 10px 12px; display: flex; align-items: flex-start; gap: 10px; '
            f'border: 0.5px solid {t("b4")}; border-radius: 16px; background: {t("layer2")}">'
            f'<span style="width: 16px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center">{status_mark(r[4])}</span>'
            f'<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">'
            f'<span style="display: flex; align-items: center; gap: 8px; min-width: 0"><span style="font-size: 14px; line-height: 22px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(run_name(r))}</span>'
            f'<span style="margin-left: auto">{status_tag(r[4])}</span></span>'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label2")}">{esc(d["title"])} · {esc(KIND[r[2]])} · 更新于 {esc(r[6])}</span>{reason}</span></a>')


def attention(label, value, sub, ic, color, href):
    return (f'<a href="{href}" class="hv" style="box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 4px; border: 0.5px solid {t("b4")}; border-radius: 16px; background: {t("layer2")}">'
            f'<span style="display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; color: {t("label2")}">{icon(ic, 14, 1.3, color)}{esc(label)}</span>'
            f'<span style="font-size: 24px; line-height: 32px; font-weight: 600">{esc(value)}</span>'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(sub)}</span></a>')


def overview_body():
    grid = (f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">'
            + attention('待处理', '3', '业务确认 1 · 工具审批 1 · 提问 1', 'Question', t('amber'), 'Inbox.dc.html')
            + attention('已阻塞', '2', '周报 · 凭据未配置', 'Warning', t('red'), 'Runs.dc.html')
            + attention('清理受阻', '1', 'REQ-1285 · 已失败，待重试清理', 'Trash', t('red'), 'Runs.dc.html')
            + attention('排队中', '1', '最早于 14:01 进入队列', 'Clock', t('label3'), 'Runs.dc.html') + '</div>')
    recent = ''.join(run_card(r) for r in ['7c1e9a42', 'a4f06c3d', '91d7c3e8'])
    upcoming = ''.join(
        f'<div style="display: flex; align-items: center; gap: 10px; min-height: 44px; border-bottom: 0.5px solid {t("b2")}">{icon(DEFS[k]["icon"], 16, 1.3, t("label2"))}'
        f'<span style="flex: 1; min-width: 0; font-size: 14px; line-height: 22px">{esc(DEFS[k]["title"])}</span><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">{esc(DEFS[k]["next"])}</span></div>'
        for k in ['zentao.defects', 'meegle.requirements', 'report.weekly'])
    return (f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">调度器运行中 · 本机任务服务 127.0.0.1:3081</p>'
            + grid + section('最近执行', btn('全部', 'ghost', href='Runs.dc.html', ic_after='ChevronRight'))
            + f'<div style="display: flex; flex-direction: column; gap: 8px">{recent}</div>' + section('即将触发') + f'<div>{upcoming}</div>')


def login():
    field = (lambda label, typ, value: f'<label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; color: {t("label2")}">{esc(label)}'
             f'<input type="{typ}" value="{attr(value)}" aria-label="{attr(label)}" style="box-sizing: border-box; width: 100%; height: 44px; padding: 0 14px; border: 0; border-radius: 12px; '
             f'background: {t("selector")}; color: {t("label")}; font-family: inherit; font-size: 16px; line-height: 22px"></label>')
    body = (f'<header style="height: 64px; flex: none; box-sizing: border-box; padding: 20px 20px 0; display: flex; align-items: center; gap: 6px; font-size: 18px; line-height: 24px; font-weight: 600">{mark(24)}DSH 任务</header>'
            f'<main style="flex: 1; box-sizing: border-box; padding: 24px 20px; display: flex; flex-direction: column; gap: 20px">'
            f'{base.tile("User", 50, 22)}<div style="display: flex; flex-direction: column; gap: 6px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 500">登录任务服务</h1>'
            f'<p style="margin: 0; font-size: 14px; line-height: 22px; color: {t("label2")}">使用部署方配置的账号和密码登录。</p></div>'
            + field('用户名', 'text', 'operator') + field('密码', 'password', 'password')
            + btn('登录', 'primary', 'md', href='Main.dc.html', style='height: 44px; width: 100%')
            + f'<details style="font-size: 13px; line-height: 20px; color: {t("label3")}"><summary style="min-height: 44px; display: flex; align-items: center">管理员入口</summary>'
            f'<span>在本机终端运行 dsh --profile task --launch-link 获取一次性登录链接。</span></details></main>')
    return frame('登录', body)


def overview():
    return frame('概览', top_bar('概览', right=trigger_btn()) + scroll(overview_body()), 'overview')


def drawer():
    """Navigation drawer over the overview: trigger, unfinished runs and settings from the desktop sidebar."""
    runs = ''.join(
        f'<a href="{RUN_LINK.get(rid, "RunDetail.dc.html")}" class="nv" style="box-sizing: border-box; min-height: 44px; padding: 0 8px; display: flex; align-items: center; gap: 10px; border-radius: 12px">'
        f'<span style="width: 16px; flex: none; display: inline-flex; justify-content: center">{status_mark(RUN_BY_ID[rid][4])}</span>'
        f'<span style="flex: 1; min-width: 0; font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(run_name(RUN_BY_ID[rid]))} · {esc(DEFS[RUN_BY_ID[rid][1]]["short"])}</span>'
        f'<span style="flex: none; font-size: 12px; line-height: 18px; color: {t("caption")}">{esc(RUN_BY_ID[rid][6])}</span></a>'
        for rid in ACTIVE[:8])
    panel = (f'<nav aria-label="导航抽屉" style="position: absolute; top: 0; left: 0; bottom: 0; width: 304px; box-sizing: border-box; padding: 6px 12px 12px; display: flex; flex-direction: column; '
             f'background: {t("sidebar")}; box-shadow: {base.elev("prominent")}; z-index: 11">'
             f'<div style="height: 56px; display: flex; align-items: center; justify-content: space-between; padding-left: 4px">'
             f'<span style="display: flex; align-items: center; gap: 6px; font-size: 18px; line-height: 24px; font-weight: 600">{mark(24)}DSH 任务</span>{touch_btn("Close", "关闭导航", href="Main.dc.html", color=t("label2"))}</div>'
             f'<a href="Trigger.dc.html" style="box-sizing: border-box; margin-top: 8px; height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0.5px solid {t("b3")}; '
             f'border-radius: 12px; background: {t("layer1")}; font-size: 14px; line-height: 22px; font-weight: 500">{icon("Play", 16, 1.3)}手动触发</a>'
             f'<div style="margin-top: 16px; height: 36px; padding-left: 4px; display: flex; align-items: center; justify-content: space-between; font-size: 14px; line-height: 20px; color: {t("caption")}">'
             f'进行中 · {len(ACTIVE)}{touch_btn("ChevronRight", "查看全部进行中的执行", href="Runs.dc.html", color=t("caption"))}</div>'
             f'<div style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 2px">{runs}</div>'
             f'<a href="Settings.dc.html" class="nv" style="box-sizing: border-box; height: 44px; padding: 0 8px; display: flex; align-items: center; gap: 14px; border-radius: 12px; font-size: 14px; line-height: 22px">'
             f'{icon("Settings", 16, 1.3)}设置</a></nav>')
    scrim = f'<a href="Main.dc.html" aria-label="关闭导航" style="position: absolute; inset: 0; background: {t("mask")}; z-index: 10"></a>'
    return frame('导航抽屉', top_bar('概览', right=trigger_btn()) + scroll(overview_body()) + scrim + panel, 'overview')


def definitions():
    rows = ''
    for k in ['zentao.defects', 'meegle.requirements', 'report.weekly', 'report.worklog', 'review.performance']:
        d = DEFS[k]
        state = tag('调度受阻', 'danger') if d.get('reason') else ''
        rows += (f'<div style="box-sizing: border-box; padding: 12px; display: flex; align-items: center; gap: 12px; border: 0.5px solid {t("b4")}; border-radius: 16px; background: {t("layer2")}">'
                 f'<a href="Definitions.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px">{base.tile(d["icon"], 36, 16)}'
                 f'<span style="min-width: 0; display: flex; flex-direction: column; gap: 2px"><span style="display: flex; align-items: center; gap: 6px; font-size: 14px; line-height: 22px; font-weight: 500">{esc(d["title"])}{state}</span>'
                 f'<span style="font-size: 12px; line-height: 18px; color: {t("label2")}">{esc(d["sched"])}{" · 下次 " + esc(d["next"]) if d["next"] else ""}</span></span></a>'
                 + (touch_btn('Play', f'触发 {d["title"]}', href='Trigger.dc.html', color=t('label2')) if d['kind'] == 'manual' else '')
                 + f'<span style="width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: none">{switch(d["enabled"], "启用 " + d["title"])}</span></div>')
    return frame('任务', top_bar('任务', right=trigger_btn()) + scroll(
        f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">已安装的任务插件；暂停后不再自动触发，进行中的执行不受影响。</p>'
        + f'<div style="display: flex; flex-direction: column; gap: 8px">{rows}</div>'), 'defs')


def runs():
    chips = ''.join(
        f'<button type="button" aria-pressed="{"true" if i == 0 else "false"}" style="box-sizing: border-box; height: 32px; padding: 0 12px; flex: none; border-radius: 999px; font-family: inherit; font-size: 13px; line-height: 20px; '
        f'border: 0.5px solid {t("b3") if i else t("label")}; background: {t("label") if i == 0 else "transparent"}; color: {t("layer3") if i == 0 else t("label")}">{esc(text)}</button>'
        for i, text in enumerate(['全部', '进行中', '等待输入', '已阻塞', '已失败']))
    filters = (f'<div style="display: flex; align-items: center; gap: 8px">'
               f'<label style="flex: 1; min-width: 0; height: 44px; box-sizing: border-box; padding: 0 12px; display: flex; align-items: center; gap: 8px; border-radius: 12px; background: {t("selector")}">'
               f'{icon("Search", 16, 1.3, t("label3"))}<input aria-label="业务键" placeholder="业务键" style="flex: 1; min-width: 0; border: 0; background: transparent; font-family: inherit; font-size: 16px; line-height: 22px; color: {t("label")}"></label>'
               f'<button type="button" aria-label="更多筛选" style="box-sizing: border-box; height: 44px; padding: 0 12px; display: inline-flex; align-items: center; gap: 4px; border: 0.5px solid {t("b3")}; border-radius: 12px; background: transparent; font-family: inherit; font-size: 14px; color: {t("label")}">'
               f'筛选{icon("ChevronDown", 14, 1.3, t("label3"))}</button></div>'
               f'<div role="group" aria-label="状态" style="display: flex; gap: 8px; overflow: hidden">{chips}</div>')
    cards = ''.join(run_card(r[0]) for r in RUNS[:7])
    return frame('执行记录', top_bar('执行记录', right=trigger_btn()) + scroll(filters + f'<div style="display: flex; flex-direction: column; gap: 8px">{cards}</div>', gap=12), 'runs')


def bubble(text, own=False):
    if own:
        return (f'<div style="align-self: flex-end; max-width: 85%; box-sizing: border-box; padding: 8px 12px; border-radius: 16px; background: {t("platform")}; font-size: 14px; line-height: 22px">{esc(text)}</div>')
    return f'<div style="font-size: 14px; line-height: 22px">{text}</div>'


def run_tabs(active):
    items = ''
    for name in ['会话', '交互', '结果', '附件', '关联执行']:
        on = name == active
        items += (f'<button type="button" role="tab" aria-selected="{"true" if on else "false"}" style="position: relative; flex: none; height: 44px; padding: 0 2px; border: 0; background: transparent; '
                  f'font-family: inherit; font-size: 14px; line-height: 22px; color: {t("label") if on else t("label3")}; font-weight: {500 if on else 400}">{esc(name)}'
                  + (f'<span style="position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 1px; background: {t("label")}"></span>' if on else '') + '</button>')
    return (f'<div role="tablist" aria-label="执行视图" style="flex: none; display: flex; gap: 20px; padding: 0 16px; overflow: hidden; border-bottom: 0.5px solid {t("b2")}">{items}</div>')


def run_detail():
    r = RUN_BY_ID['7c1e9a42']
    right = touch_btn('Info', '执行信息', href='RunInfo.dc.html') + touch_btn('Ellipsis', '更多操作', color=t('label2'))
    head = top_bar(run_name(r), back='Runs.dc.html', right=right, sub=f'{DEFS[r[1]]["title"]} · 运行中')
    convo = (f'<div style="font-size: 12px; line-height: 18px; color: {t("label3")}">阶段 1 / 3 · 分析缺陷</div>'
             + bubble('分析 BUG-4821：登录页在弱网下重复提交。复现步骤、日志与附件见禅道。', own=True)
             + f'<button type="button" style="align-self: flex-start; height: 32px; padding: 0; border: 0; background: transparent; display: inline-flex; align-items: center; gap: 4px; font-family: inherit; font-size: 13px; color: {t("label3")}">'
               f'用时 2 分 14 秒{icon("ChevronRight", 14, 1.3)}</button>'
             + bubble('已定位到 <code style="font-size: 12px">LoginForm.submit</code> 在请求未返回时没有禁用按钮。我会补充防重复提交并编写回归测试。')
             + f'<div style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: {t("label2")}">{base.spinner(14, t("blue"))}正在运行测试 · pnpm vitest run login</div>')
    composer = (f'<div style="flex: none; box-sizing: border-box; padding: 8px 12px 12px; border-top: 0.5px solid {t("b2")}; background: {t("base")}">'
                f'<div style="display: flex; align-items: flex-end; gap: 8px; padding: 6px 6px 6px 14px; border: 0.5px solid {t("b3")}; border-radius: 20px; background: {t("layer1")}">'
                f'<textarea aria-label="补充输入" rows="1" placeholder="补充信息，Agent 在下一步读取" style="flex: 1; min-width: 0; min-height: 32px; border: 0; resize: none; background: transparent; '
                f'font-family: inherit; font-size: 16px; line-height: 22px; color: {t("label")}; padding: 5px 0"></textarea>'
                f'<button type="button" aria-label="发送" style="width: 36px; height: 36px; flex: none; border: 0; border-radius: 999px; background: {t("primary")}; color: {t("fg")}; display: inline-flex; align-items: center; justify-content: center">{icon("Send", 16, 1.3)}</button></div></div>')
    return frame('执行详情', head + run_tabs('会话') + scroll(convo, pad='16px', gap=14) + composer)


def run_info():
    """Run detail right sidebar as a full-width sheet: on a phone it always covers the page."""
    r = RUN_BY_ID['7c1e9a42']
    kv = ''.join(base.kv(k, esc(v)) for k, v in [('状态', '运行中'), ('任务', DEFS[r[1]]['title']), ('业务键', r[3]), ('类型', KIND[r[2]]),
                                                    ('创建', f'今天 {r[5]}'), ('更新', f'今天 {r[6]}'), ('父执行', r[7]), ('资源清理', '待清理')])
    sheet = (f'<section role="dialog" aria-label="执行信息" style="position: absolute; inset: 0; display: flex; flex-direction: column; background: {t("base")}; z-index: 11">'
             f'<div style="height: {TOP}px; flex: none; box-sizing: border-box; padding: 0 6px 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 0.5px solid {t("b3")}">'
             f'<div role="tablist" aria-label="侧边栏" style="display: flex; gap: 4px">'
             f'<button type="button" role="tab" aria-selected="true" style="height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: {t("navActive")}; font-family: inherit; font-size: 14px; color: {t("label")}">状态</button>'
             f'<button type="button" role="tab" aria-selected="false" style="height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 14px; color: {t("label3")}">记录详情</button></div>'
             f'{touch_btn("Close", "关闭侧边栏", href="RunDetail.dc.html", color=t("label2"))}</div>'
             f'<div style="flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; padding: 12px 16px; display: flex; flex-direction: column; gap: 16px">'
             f'<div>{kv}</div>' + notice('info', '实时更新', '状态和会话随任务事件刷新')
             + f'<div style="display: flex; flex-direction: column; gap: 8px">{btn("取消执行", "outline", "md", danger=True, style="height: 44px; width: 100%")}</div></div></section>')
    return frame('执行信息', top_bar(run_name(r), back='Runs.dc.html') + sheet)


def inbox():
    a = RUN_BY_ID['a4f06c3d']
    options = ''.join(
        f'<label style="box-sizing: border-box; min-height: 44px; padding: 10px 12px; display: flex; align-items: flex-start; gap: 10px; border: 0.5px solid {t("label") if i == 0 else t("b3")}; border-radius: 12px; font-size: 14px; line-height: 22px">'
        f'<input type="radio" name="plan" {"checked" if i == 0 else ""} aria-label="{attr(text)}" style="margin: 4px 0 0">{esc(text)}</label>'
        for i, text in enumerate(['方案 A：扩展现有导出接口', '方案 B：新增独立导出服务', '暂不实现，补充需求']))
    confirm = card(
        f'<div style="display: flex; flex-direction: column; gap: 12px">'
        f'<div style="display: flex; align-items: center; gap: 8px">{tag(SOURCE["business"], "warning")}<a href="RunDetail.dc.html" class="lk" style="font-size: 13px; line-height: 20px; color: {t("label2")}">{esc(a[3])} · {esc(DEFS[a[1]]["title"])}</a></div>'
        f'<p style="margin: 0; font-size: 14px; line-height: 22px">{esc(a[9])}：需求要求导出 10 万行以上的报表。</p>{options}'
        f'<textarea aria-label="补充说明" rows="2" placeholder="补充说明（可选）" style="box-sizing: border-box; width: 100%; padding: 10px 12px; border: 0; border-radius: 12px; background: {t("selector")}; font-family: inherit; font-size: 16px; line-height: 22px; color: {t("label")}; resize: none"></textarea>'
        f'{btn("提交回复", "primary", "md", style="height: 44px; width: 100%")}</div>', pad='14px')
    approval = card(
        f'<div style="display: flex; flex-direction: column; gap: 10px"><div style="display: flex; align-items: center; gap: 8px">{tag(SOURCE["tool_approval"], "info")}'
        f'<span style="font-size: 13px; line-height: 20px; color: {t("label2")}">BUG-4826 · 禅道缺陷轮询</span></div>'
        f'<p style="margin: 0; font-size: 14px; line-height: 22px">Agent 请求运行 <code style="font-size: 12px">git push origin fix/BUG-4826</code></p>'
        f'<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">{btn("拒绝", "outline", "md", style="height: 44px")}{btn("允许", "primary", "md", style="height: 44px")}</div></div>', pad='14px')
    chips = ''.join(f'<span style="flex: none">{tag(text, "solid" if i == 0 else "neutral")}</span>' for i, text in enumerate(['全部 3', '业务确认 1', '工具审批 1', 'Agent 提问 1']))
    return frame('待处理', top_bar('待处理', right=trigger_btn()) + scroll(f'<div style="display: flex; gap: 8px; overflow: hidden">{chips}</div>' + confirm + approval, gap=12), 'inbox')


def trigger():
    """Manual trigger as a full-height sheet: the desktop dialog keeps its fields, the footer stays above the keyboard."""
    picker = (f'<button type="button" aria-label="选择任务" style="box-sizing: border-box; width: 100%; min-height: 56px; padding: 0 12px 0 10px; display: flex; align-items: center; gap: 12px; '
              f'border: 0.5px solid {t("b3")}; border-radius: 16px; background: {t("layer1")}; font-family: inherit; text-align: left; color: {t("label")}">{base.tile("Play", 36, 16)}'
              f'<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-size: 14px; line-height: 22px">绩效自评</span>'
              f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">review.performance · 手动触发</span></span>{icon("ChevronDown", 16, 1.3, t("label3"))}</button>')
    field = (lambda label, hint, rows: f'<label style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">{esc(label)}</span>'
             f'<textarea aria-label="{attr(label)}" rows="{rows}" style="box-sizing: border-box; width: 100%; padding: 10px 12px; border: 0; border-radius: 12px; background: {t("selector")}; '
             f'font-family: inherit; font-size: 16px; line-height: 22px; color: {t("label")}; resize: none">{esc(hint)}</textarea></label>')
    sheet = (f'<section role="dialog" aria-modal="true" aria-label="手动触发" style="position: absolute; left: 0; right: 0; bottom: 0; top: 24px; display: flex; flex-direction: column; '
             f'border-radius: 28px 28px 0 0; background: {t("layer2")}; box-shadow: {base.elev("prominent")}; z-index: 11; overflow: hidden">'
             f'<div style="flex: none; display: flex; align-items: center; justify-content: space-between; padding: 12px 8px 4px 20px">'
             f'<h2 style="margin: 0; font-size: 16px; line-height: 24px; font-weight: 500">手动触发</h2>{touch_btn("Close", "关闭", href="Main.dc.html", color=t("label2"))}</div>'
             f'<div style="flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; padding: 4px 20px 16px; display: flex; flex-direction: column; gap: 16px">'
             f'<p style="margin: 0; font-size: 14px; line-height: 22px; color: {t("label2")}">新建一个执行；输入按任务的 manualInputSchema 校验。</p>{picker}'
             + field('评估周期', '2026 Q3', 1) + field('自评要点', '完成 Task Web 客户端与移动端适配；推动发布流程。', 4)
             + f'</div><div style="flex: none; box-sizing: border-box; padding: 12px 20px 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 0.5px solid {t("b2")}">'
             f'{btn("取消", "outline", "md", href="Main.dc.html", style="height: 44px")}{btn("触发", "primary", "md", href="RunDetail.dc.html", style="height: 44px")}</div></section>')
    scrim = f'<div style="position: absolute; inset: 0; background: {t("mask")}; z-index: 10"></div>'
    return frame('手动触发', top_bar('概览', right=trigger_btn()) + scroll(overview_body()) + scrim + sheet, 'overview')


def settings():
    tabs = ''.join(
        f'<button type="button" role="tab" aria-selected="{"true" if i == 0 else "false"}" style="flex: none; height: 36px; padding: 0 12px; border: 0; border-radius: 12px; '
        f'background: {t("navActive") if i == 0 else "transparent"}; font-family: inherit; font-size: 14px; color: {t("label") if i == 0 else t("label2")}">{esc(text)}</button>'
        for i, text in enumerate(['通用', '连接', '凭据', '访问令牌', '关于']))
    options = ''.join(
        f'<button type="button" aria-pressed="{"true" if i == 2 else "false"}" style="box-sizing: border-box; flex: 1; height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; '
        f'border-radius: 20px; border: 0.5px solid {t("caption") if i == 2 else t("b4")}; background: {t("platform") if i == 2 else "transparent"}; font-family: inherit; font-size: 14px; color: {t("label")}">{icon(ic, 20, 1.3)}{esc(text)}</button>'
        for i, (text, ic) in enumerate([('浅色', 'Light'), ('深色', 'Dark'), ('跟随系统', 'Followsystem')]))
    row = (lambda label, control: f'<div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 0; border-bottom: 0.5px solid {t("b2")}">'
           f'<span style="font-size: 14px; line-height: 22px">{esc(label)}</span>{control}</div>')
    body = (f'<div role="tablist" aria-label="设置分类" style="flex: none; display: flex; gap: 4px; padding: 8px 12px; overflow: hidden; border-bottom: 0.5px solid {t("b2")}">{tabs}</div>'
            + scroll(row('语言', base.selector('简体中文', '语言', 358)) + row('外观', f'<div style="display: flex; gap: 8px">{options}</div>')
                     + row('时间显示', base.selector('本机时区（UTC+08:00）', '时间显示', 358)), pad='4px 16px 24px', gap=0))
    return frame('设置', top_bar('设置', back='Main.dc.html') + body)


ROWS = [
    ('row1', '01 接入、导航与总览', [('Login', login, '登录'), ('Main', overview, '概览'), ('Drawer', drawer, '导航抽屉'), ('Trigger', trigger, '手动触发')],
     'blue', '宽度 ≤ 760 px 时，左侧导航改为顶栏菜单打开的抽屉，底部标签栏提供五个分区；待处理数量显示为角标。手动触发等对话框改为底部弹出的全高面板，标题与正文在内部滚动，按钮固定在底部。'),
    ('row2', '02 任务与执行', [('Definitions', definitions, '任务'), ('Runs', runs, '执行记录'), ('RunDetail', run_detail, '执行详情'), ('RunInfo', run_info, '执行信息')],
     'purple', '执行记录的表格在手机上改为卡片列表，筛选器折叠为搜索框和状态标签。执行详情的顶栏带返回、执行信息与更多操作；标签页可横向滚动，输入框固定在底部。右侧边栏在手机上总是覆盖整页。'),
    ('row3', '03 待处理与设置', [('Inbox', inbox, '待处理'), ('Settings', settings, '设置')],
     'orange', '待处理卡片的选项与按钮占满宽度，触控目标不小于 44 px；输入框字号 16 px，避免 iOS 聚焦时缩放。设置以全屏页显示，分类改为顶部横向标签。'),
]


def main():
    CANVAS.mkdir(parents=True, exist_ok=True)
    base.set_theme(base.LIGHT)
    boards, order, notes, files = {}, [], {}, {}
    y = 0
    for rid, title, items, color, sticky in ROWS:
        x = 0
        for name, fn, label in items:
            fname = f'{name}.dc.html'
            files[fname] = fn()
            boards[fname] = {'x': x, 'y': y, 'w': W, 'h': H, 'title': label, 'is_interactive': True}
            order.append(fname)
            x += W + 80
        notes[rid] = {'x': 0, 'y': y - 240, 'text': title, 'kind': 'title1', 'maxW': max(x - 80, 1200)}
        notes[rid + '-note'] = {'x': -620, 'y': y, 'text': sticky, 'w': 540, 'maxH': 520, 'color': color, 'size': 'm'}
        y += H + 120 + 240
    for fname, doc in files.items():
        (CANVAS / fname).write_text(doc)
    canvas = {'v': 3, 'createdOnFiles': {'v': 1, 'at': CREATED}, 'title': 'DSH 任务 Web 移动端原型', 'launch': {'view': 'canvas'},
              'pages': [], 'boards': boards, 'order': order, 'notes': notes, 'designSystems': []}
    (CANVAS / 'canvas.json').write_text(json.dumps(canvas, ensure_ascii=False, indent=1) + '\n')
    print(f'{len(files)} artboards, {sum(len(d.encode()) for d in files.values()) / 1024:.0f} KiB')


if __name__ == '__main__':
    os.chdir(HERE)
    main()
