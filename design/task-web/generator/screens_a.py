"""Entry, overview, diagnostics and definition artboards."""
import json
from base import *  # noqa: F401,F403
from data import DEFS, RUNS, RUN_BY_ID, run_link
from shell import sidebar, main, page_header, modal_layer, dialog

W = 1440


# ================================================================ Login
def login():
    h = 900
    steps = [
        ('done', '任务服务可访问', mono('http://127.0.0.1:3081/api/task/v1', 12, t('label3'))),
        ('ongoing', '正在验证启动链接', f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">一次性链接，60 秒内有效</span>'),
        ('idle', '建立浏览器会话', f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">HttpOnly Cookie，保留 30 天</span>'),
    ]
    step_html = ''
    for st, label, sub in steps:
        m = spinner(16, t('blue')) if st == 'ongoing' else (icon('Check', 16, 1.3, t('green')) if st == 'done' else f'<span style="width: 16px; display: inline-flex; justify-content: center">{dot("idle")}</span>')
        col = t('label') if st != 'idle' else t('label3')
        step_html += (f'<li style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 0">'
                      f'<span style="height: 22px; display: inline-flex; align-items: center">{m}</span>'
                      f'<span style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 14px; line-height: 22px; color: {col}">{label}</span>{sub}</span></li>')
    main_card = (
        f'<section aria-label="连接任务服务" style="box-sizing: border-box; width: 460px; padding: 32px 32px 28px; border-radius: 28px; background: {t("layer2")}; box-shadow: {elev("prominent")}; display: flex; flex-direction: column; gap: 20px">'
        f'{tile("Link", 50, 22)}'
        f'<div style="display: flex; flex-direction: column; gap: 8px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 500">连接本机任务服务</h1>'
        f'<p style="margin: 0; font-size: 14px; line-height: 22px; color: {t("label2")}">DSH 任务使用一次性启动链接登录。验证通过后，浏览器保留会话，关闭页面不会影响正在运行的任务。</p></div>'
        f'<ol style="margin: 0; padding: 0 0 0 4px; list-style: none; border-top: 0.5px solid {t("b2")}; border-bottom: 0.5px solid {t("b2")}">{step_html}</ol>'
        f'<div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 20px; color: {t("label3")}">'
        f'<span>没有链接？在本机终端获取：</span>'
        f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 12px; border-radius: 12px; background: {t("code")}; border: 0.5px solid {t("b2")}">'
        f'{mono("dsh --profile task --launch-link", 12, t("label"))}{icon_btn("Copy", "复制命令", 24, t("label3"))}</div>'
        f'<span>命令输出链接与过期时间。任务服务未运行时，先在另一个终端运行 {mono("dsh --profile task", 12, t("label2"))}。</span></div></section>')

    def state_card(kind, title, body, action):
        strip_bg, strip_fg, ic = {'error': (t('redTint'), t('red'), 'Warning'), 'warning': (t('amber3'), t('amberLabel'), 'WarningTriangle'),
                                  'neutral': (t('platform'), t('label2'), 'User')}[kind]
        return (f'<section style="box-sizing: border-box; width: 360px; border-radius: 20px; background: {t("layer2")}; box-shadow: {elev("panel", t("b2"))}; overflow: hidden">'
                f'<div style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: {strip_bg}; color: {strip_fg}; font-size: 13px; line-height: 18px">{icon(ic, 14, 1.3)}<span>{esc(title)}</span></div>'
                f'<div style="padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 12px">'
                f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">{body}</p>'
                f'<div style="display: flex; justify-content: flex-end">{action}</div></div></section>')

    others = (f'<div style="display: flex; flex-direction: column; gap: 16px">'
              f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">其他状态</span>'
              + state_card('error', '启动链接已失效', '链接已被使用或已超过 60 秒。请在终端重新运行 --launch-link 获取新链接。', btn('复制命令', 'outline', 'sm', 'Copy'))
              + state_card('neutral', '浏览器会话已结束', '会话已过期或已在其他页面退出登录。正在运行的任务不受影响。', btn('重新连接', 'primary', 'sm'))
              + state_card('warning', '任务服务正在恢复', '服务已启动，但恢复与调度尚未就绪。就绪后会自动继续连接，无需刷新页面。', f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: {t("label3")}">{spinner(14)}等待就绪</span>')
              + '</div>')
    body = (f'<div style="height: 72px; flex: none; box-sizing: border-box; padding: 24px 28px; display: flex; align-items: center; gap: 6px">{mark(24)}'
            f'<span style="font-size: 18px; line-height: 24px; font-weight: 600">DSH 任务</span></div>'
            f'<div style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 64px; padding-bottom: 72px">{main_card}{others}</div>')
    return page('连接任务服务', root(body, W, h, 'column'), W, h)


# ================================================================ Overview
def overview(dark=False):
    set_theme(DARK if dark else LIGHT)
    h = 900

    def att(label, n, mk, sub, href):
        return (f'<a href="{href}" class="hv" style="box-sizing: border-box; flex: 1; min-width: 0; padding: 16px 20px; border-radius: 20px; border: 0.5px solid {t("b4")}; background: {t("layer2")}; display: flex; flex-direction: column; gap: 6px">'
                f'<span style="display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; color: {t("label2")}">{mk}{esc(label)}</span>'
                f'<span style="font-size: 24px; line-height: 32px; font-weight: 600; color: {t("label")}">{esc(n)}</span>'
                f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(sub)}</span></a>')
    attention = (f'<div style="display: flex; gap: 12px">'
                 + att('待处理', '3', dot('warning'), '业务确认 1 · 工具审批 1 · 提问 1', 'Inbox.dc.html')
                 + att('已阻塞', '1', dot('error'), '周报 · 凭据未配置', 'RunBlocked.dc.html')
                 + att('清理受阻', '1', dot('error'), 'REQ-1285 · 已失败，待重试清理', 'RunCleanup.dc.html')
                 + att('排队中', '2', dot('idle'), '最早于 14:01 进入队列', 'Runs.dc.html')
                 + '</div>')

    recent_ids = ['7c1e9a42', 'a4f06c3d', '3b9d0f17', 'e2c4b8a1', 'f3a8d261', '2c5e8f07']
    rows = ''
    for i, rid in enumerate(recent_ids):
        r = RUN_BY_ID[rid]
        d = DEFS[r[1]]
        name = r[3] if r[3] else f'{KIND[r[2]]}执行 · {r[5]}'
        border = '' if i == len(recent_ids) - 1 else f'border-bottom: 0.5px solid {t("b2")}; '
        rows += (f'<a href="{run_link(r)}" class="hv" style="box-sizing: border-box; height: 48px; padding: 0 12px; margin: 0 -12px; display: flex; align-items: center; gap: 12px; border-radius: 12px">'
                 f'<span style="width: 16px; display: inline-flex; justify-content: center">{status_mark(r[4])}</span>'
                 f'<span style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; {border}height: 48px">'
                 f'<span style="font-size: 14px; line-height: 22px; font-weight: 500; white-space: nowrap">{esc(name)}</span>'
                 f'<span style="font-size: 13px; line-height: 20px; color: {t("label3")}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{esc(d["title"])}</span>'
                 f'<span style="flex: 1"></span>{status_tag(r[4])}'
                 f'<span style="width: 44px; text-align: right; font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(r[6])}</span></span></a>')
    recent = card(section_title('最近执行', None, f'<a href="Runs.dc.html" class="lk" style="font-size: 13px; line-height: 20px; color: {t("link")}; font-weight: 500">查看全部</a>')
                  + f'<div style="margin-top: 8px; display: flex; flex-direction: column">{rows}</div>', '16px 20px 8px', 'flex: 1.55; min-width: 0')

    upcoming = [('禅道缺陷轮询', 'Refresh', '今天 14:20', '8 分钟后', True), ('Meegle 需求轮询', 'Refresh', '今天 14:25', '13 分钟后', True),
                ('周报', 'AlarmClock', '10-02 周五 17:00', '2 天后', True), ('工时填报', 'AlarmClock', '已暂停', '', False)]
    up = ''
    for name, ic, when, rel, on in upcoming:
        right = (f'<span style="display: flex; flex-direction: column; align-items: flex-end"><span style="font-size: 13px; line-height: 20px">{esc(when)}</span>'
                 f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(rel)}</span></span>') if on else tag('调度受阻', 'danger')
        up += (f'<div style="display: flex; align-items: center; gap: 10px; min-height: 44px">{icon(ic, 16, 1.3, t("label2"))}'
               f'<span style="flex: 1; font-size: 14px; line-height: 22px">{esc(name)}</span>{right}</div>')
    upcoming_card = card(section_title('即将触发') + f'<div style="margin-top: 4px">{up}</div>', '16px 20px 10px')

    cap = card(section_title('执行名额', None, f'<a href="Diagnostics.dc.html" class="lk" style="font-size: 13px; line-height: 20px; color: {t("link")}; font-weight: 500">诊断</a>')
               + f'<div style="margin-top: 8px; display: flex; align-items: baseline; gap: 6px"><span style="font-size: 24px; line-height: 32px; font-weight: 600">3</span>'
               f'<span style="font-size: 13px; line-height: 20px; color: {t("label3")}">/ 4 已使用</span></div>'
               + f'<div style="margin-top: 8px">{progress(0.75)}</div>'
               + f'<div style="margin-top: 12px; display: flex; gap: 16px; font-size: 12px; line-height: 18px; color: {t("label3")}"><span>排队 2</span><span>待投递 0</span><span>恢复错误 0</span></div>',
               '16px 20px 16px')
    body_main = (page_header('概览', '调度器运行中 · 本机任务服务 127.0.0.1:3081', icon_btn('Refresh', '刷新', 28, t('caption')))
                 + attention
                 + f'<div style="display: flex; gap: 16px; align-items: flex-start">{recent}'
                 f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px">{upcoming_card}{cap}</div></div>')
    out = page('概览' + ('（深色）' if dark else ''), root(sidebar('overview', h) + main(body_main, gap=24), W, h), W, h)
    set_theme(LIGHT)
    return out


# ================================================================ Diagnostics
def diagnostics():
    h = 1100

    def metric(label, value, sub='', extra=''):
        return card(f'<div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">{esc(label)}</span>'
                    f'<span style="font-size: 20px; line-height: 28px; font-weight: 600">{value}</span>'
                    + (f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{sub}</span>' if sub else '') + extra + '</div>', '16px 20px', 'min-width: 0')

    grid = (f'<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">'
            + metric('调度器', f'<span style="display: inline-flex; align-items: center; gap: 8px">{dot("done")}运行中</span>', '恢复已完成，就绪检查通过')
            + metric('执行名额', '3 / 4', '', f'<div style="margin-top: 4px">{progress(0.75)}</div>')
            + metric('排队', '2', '最早 14:01 · 11 分钟前')
            + metric('执行总数', '571', '进行中 10 · 已结束 561')
            + metric('待处理输入', '3', '等待人工回复')
            + metric('恢复错误', '0', '启动恢复无错误')
            + metric('清理失败', f'<span style="color: {t("red")}">1</span>', '需要修复后重试')
            + metric('待投递会话屏障', '0', '无积压')
            + '</div>')

    storage = card(section_title('存储') + f'<div style="margin-top: 8px; display: flex; align-items: center; gap: 16px">'
                   f'<div style="flex: 1">{progress(0.576, t("primary"), "100%", 8)}</div>'
                   f'<span style="font-size: 13px; line-height: 20px; color: {t("label2")}; white-space: nowrap">已用 288 GB · 可用 212 GB / 500 GB</span>{tag("容量正常", "success")}</div>', '16px 20px')

    def table(cols, rows, widths):
        head = ''.join(f'<th scope="col" style="text-align: left; padding: 0 8px 8px 0; font-size: 12px; line-height: 18px; font-weight: 400; color: {t("label3")}; width: {w}">{esc(c)}</th>' for c, w in zip(cols, widths))
        body = ''
        for r in rows:
            body += '<tr>' + ''.join(f'<td style="padding: 10px 8px 10px 0; border-top: 0.5px solid {t("b2")}; font-size: 13px; line-height: 20px; vertical-align: top">{c}</td>' for c in r) + '</tr>'
        return f'<table style="width: 100%; border-collapse: collapse"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'

    def run_ref(rid):
        r = RUN_BY_ID[rid]
        return f'<a href="{run_link(r)}" class="lk" style="color: {t("link")}; font-weight: 500">{esc(r[3] or DEFS[r[1]]["title"])}</a> {mono(rid, 12, t("label3"))}'

    res = card(section_title('资源占用', 3) + '<div style="margin-top: 8px">' + table(
        ['资源', '容量', '占用的执行'],
        [[mono('repo:mobile-app', 12, t('label')), '1', run_ref('7c1e9a42')],
         [mono('compiler', 12, t('label')), '2', run_ref('7c1e9a42') + '<br>' + run_ref('8e3f5b21')],
         [mono('browser:meegle', 12, t('label')), '1', run_ref('a4f06c3d')]], ['34%', '14%', '52%']) + '</div>', '16px 20px 8px', 'flex: 1; min-width: 0')

    ret = card(section_title('插件退役', 1) + '<div style="margin-top: 8px">' + table(
        ['任务', '代码版本', '状态', '时间'],
        [[f'日报 {mono("report.daily", 12, t("label3"))}', mono('0.6.0', 12), tag('已退役', 'outline'), '09-20 10:02 → 10:05']], ['40%', '18%', '18%', '24%'])
        + f'<p style="margin: 8px 0 0; font-size: 12px; line-height: 18px; color: {t("label3")}">退役完成后才能安全卸载插件代码包。</p></div>', '16px 20px 12px', 'flex: 1; min-width: 0')

    events = [('14:11:40', 'stage.started', '7c1e9a42'), ('14:10:02', 'cancel.requested', '8e3f5b21'), ('14:08:15', 'stage.waiting', 'a4f06c3d'),
              ('14:05:00', 'stage.retry', '91d7c3e8'), ('14:01:12', 'run.reserved', '0e6a9b14'), ('14:01:12', 'run.reserved', 'c81f2a55'),
              ('14:01:05', 'run.ended', '3b9d0f17'), ('13:58:41', 'definition.configured', None)]
    ev = ''
    for tm, name, rid in events:
        ev += (f'<div style="display: flex; align-items: center; gap: 12px; height: 32px; border-top: 0.5px solid {t("b2")}">'
               f'{mono(tm, 12, t("label3"))}<span style="flex: 1; font-family: {MONO}; font-size: 12px; line-height: 18px; color: {t("label")}">{esc(name)}</span>'
               + (mono(rid, 12, t("label3")) if rid else mono('—', 12, t('caption'))) + '</div>')
    stream = card(section_title('实时事件', None, f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: {t("label3")}">{dot("done")}已连接 · 游标 {mono("9f3c2a1e-…:48213", 12, t("label3"))}</span>')
                  + f'<div style="margin-top: 8px">{ev}</div>', '16px 20px 8px', 'flex: 1; min-width: 0')

    body_main = (page_header('诊断', '调度、队列、持久化与存储的运行计数，不包含业务内容或凭据值', tag('就绪', 'success') + icon_btn('Refresh', '刷新', 28, t('caption')))
                 + grid + storage
                 + f'<div style="display: flex; gap: 16px; align-items: flex-start">{res}{ret}</div>'
                 + stream)
    return page('诊断', root(sidebar('diag', h) + main(body_main, gap=20), W, h), W, h)


# ================================================================ Definitions list
def def_rows_js():
    rows = []
    for did, d in DEFS.items():
        if not d['installed']:
            continue
        rows.append(dict(id=did, title=d['title'], kind=KIND[d['kind']], sched=d['sched'], next=d['next'] or '', code=d['code'], rev=d['rev'],
                         enabled=d['enabled'], reason=d.get('reason', ''), manual=d['kind'] == 'manual', polling=d['kind'] == 'polling', scheduled=d['kind'] == 'scheduled',
                         href='Schedule.dc.html' if d['kind'] == 'scheduled' else 'Definition.dc.html'))
    return rows


def definitions(extra_layer='', title='任务', extra_js=''):
    h = 900
    rows = def_rows_js()
    installed = (
        f'<sc-for list="{{{{ rows }}}}" as="d" hint-placeholder-count="5">'
        f'<li class="hv" style="box-sizing: border-box; min-height: 66px; margin: 0 -8px; padding: 8px; display: flex; align-items: center; gap: 14px; border-radius: 20px">'
        f'<a href="{{{{ d.href }}}}" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">'
        f'<sc-if value="{{{{ d.polling }}}}" hint-placeholder-val="{{{{ true }}}}">{tile("Refresh")}</sc-if>'
        f'<sc-if value="{{{{ d.scheduled }}}}" hint-placeholder-val="{{{{ false }}}}">{tile("AlarmClock")}</sc-if>'
        f'<sc-if value="{{{{ d.manual }}}}" hint-placeholder-val="{{{{ false }}}}">{tile("Play")}</sc-if>'
        f'<span style="min-width: 0; display: flex; flex-direction: column; gap: 4px">'
        f'<span style="display: flex; align-items: center; gap: 8px"><span style="font-size: 14px; line-height: 20px; font-weight: 500; color: {t("label")}">{{{{ d.title }}}}</span>'
        f'<span style="display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; background: {t("platform")}; color: {t("label2")}">{{{{ d.kind }}}}</span>'
        f'<sc-if value="{{{{ d.paused }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; border: 0.5px solid {t("b4")}; color: {t("label3")}">已暂停</span></sc-if>'
        f'<sc-if value="{{{{ d.blocked }}}}" hint-placeholder-val="{{{{ false }}}}">{tag("调度受阻", "danger")}</sc-if></span>'
        f'<span style="font-size: 13px; line-height: 18px; color: {t("label3")}">{{{{ d.desc }}}}</span>'
        f'<sc-if value="{{{{ d.blocked }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="font-size: 12px; line-height: 18px; color: {t("red")}">'
        f'调度器已停用此任务：<span style="font-family: {MONO}">{{{{ d.reason }}}}</span> · 修正配置后重新启用</span></sc-if></span></a>'
        f'<sc-if value="{{{{ d.manual }}}}" hint-placeholder-val="{{{{ false }}}}"><a href="Trigger.dc.html" style="box-sizing: border-box; height: 28px; padding: 0 10px; display: inline-flex; align-items: center; gap: 4px; border: 0.5px solid {t("b3")}; border-radius: 8px; font-size: 12px; line-height: 18px; color: {t("label")}">{icon("Play", 14, 1.3)}<span>触发</span></a></sc-if>'
        f'<button type="button" role="switch" aria-checked="{{{{ d.checked }}}}" aria-label="{{{{ d.aria }}}}" onClick="{{{{ d.toggle }}}}" '
        f'style="box-sizing: border-box; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; flex: none; cursor: pointer; display: flex; background: {{{{ d.track }}}}">'
        f'<span style="display: block; width: 16px; height: 16px; border-radius: 50%; background: {{{{ d.thumb }}}}; transform: {{{{ d.shift }}}}"></span></button>'
        f'</li></sc-for>')
    old = DEFS['report.daily']
    uninstalled = (f'<li style="box-sizing: border-box; min-height: 66px; margin: 0 -8px; padding: 8px; display: flex; align-items: center; gap: 14px; border-radius: 20px">'
                   f'<span style="opacity: 0.5; display: inline-flex">{tile("AlarmClock")}</span>'
                   f'<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">'
                   f'<span style="display: flex; align-items: center; gap: 8px"><span style="font-size: 14px; line-height: 20px; font-weight: 500; color: {t("label2")}">{old["title"]}</span>{tag("定时", "neutral")}{tag("未安装", "outline")}</span>'
                   f'<span style="font-size: 13px; line-height: 18px; color: {t("label3")}">插件代码不可用，不会再触发 · 保留 23 次历史执行 · v{old["code"]}</span></span>'
                   f'{btn("查看历史", "outline", "sm", href="Runs.dc.html")}</li>')
    body_main = (page_header(title, '由业务插件注册；启停与配置只影响之后的触发，进行中的执行保留原有配置', icon_btn('Refresh', '刷新', 28, t('caption')))
                 + f'<div style="display: flex; flex-direction: column; gap: 8px">{section_title("已安装", 5)}<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px">{installed}</ul></div>'
                 + f'<div style="display: flex; flex-direction: column; gap: 8px">{section_title("已卸载", 1)}<ul style="margin: 0; padding: 0; list-style: none">{uninstalled}</ul></div>')
    init = {r['id']: r['enabled'] for r in rows}
    data = [{k: v for k, v in r.items() if k != 'enabled'} for r in rows]
    logic = f'''class Component extends DCLogic {{
  renderVals() {{
    const s = this.state || {{}};
    const on = s.on || {json.dumps(init)};
    const cleared = s.cleared || {{}};
    const base = {json.dumps(data, ensure_ascii=False)};
    const rows = base.map((d) => {{
      const enabled = !!on[d.id];
      const blocked = !enabled && d.reason !== '' && !cleared[d.id];
      const next = d.next ? ' · 下次 ' + d.next : '';
      return Object.assign({{}}, d, {{
        paused: !enabled && !blocked,
        blocked,
        checked: enabled ? 'true' : 'false',
        aria: (enabled ? '暂停 ' : '启用 ') + d.title,
        desc: d.sched + (enabled ? next : '') + ' · v' + d.code + ' · 配置修订 ' + d.rev,
        track: enabled ? '{t("primary")}' : '{t("trackOff")}',
        thumb: enabled ? '{t("fg")}' : '{t("thumb")}',
        shift: enabled ? 'translateX(16px)' : 'none',
        toggle: () => this.setState({{ on: Object.assign({{}}, on, {{ [d.id]: !enabled }}), cleared: Object.assign({{}}, cleared, {{ [d.id]: true }}) }}),
      }});
    }});
    const extra = {{}};
{extra_js}
    return Object.assign({{ rows }}, extra);
  }}
}}'''
    return page('任务', root(sidebar('defs', h) + main(body_main, gap=28) + extra_layer, W, h), W, h, logic)


# ================================================================ Definition (polling) config
def def_header(did, crumb=True, tabs_sel='配置'):
    d = DEFS[did]
    tabs = ''
    for label, href, count in [('配置', None, None), ('执行记录', 'Runs.dc.html', str(d['runs'])), ('生命周期', 'Retire.dc.html', None)]:
        sel = label == tabs_sel
        bg = t('layer3') if sel else 'transparent'
        bd = t('b3') if sel else 'transparent'
        cnt = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; font-weight: 400">{count}</span>' if count else ''
        inner = f'<span>{label}</span>{cnt}'
        st = (f'box-sizing: border-box; height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; border: 0.5px solid {bd}; border-radius: 12px; '
              f'background: {bg}; color: {t("label") if sel else t("label2")}; font-size: 14px; line-height: 20px; font-weight: {600 if sel else 400}; white-space: nowrap')
        tabs += (f'<a href="{href}" role="tab" style="{st}">{inner}</a>' if href else f'<span role="tab" aria-selected="true" style="{st}">{inner}</span>')
    tabbar = f'<div role="tablist" aria-label="任务视图" style="display: inline-flex; padding: 4px; border-radius: 16px; background: {t("platform")}; align-self: flex-start">{tabs}</div>'
    enabled_tag = tag('已启用', 'success') if d['enabled'] else tag('已暂停', 'outline')
    head = (f'<div style="display: flex; align-items: center; gap: 4px; font-size: 13px; line-height: 20px">'
            f'<a href="Definitions.dc.html" class="lk" style="color: {t("label3")}">任务</a>{icon("ChevronRight", 12, 1.3, t("caption"))}<span style="color: {t("label3")}">{d["title"]}</span></div>'
            f'<header style="display: flex; align-items: center; justify-content: space-between; gap: 16px">'
            f'<div style="display: flex; align-items: center; gap: 14px">{tile(d["icon"])}'
            f'<div style="display: flex; flex-direction: column; gap: 4px"><div style="display: flex; align-items: center; gap: 8px">'
            f'<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 500">{d["title"]}</h1>{tag(KIND[d["kind"]], "neutral")}{enabled_tag}</div>'
            f'<span style="display: flex; gap: 12px; font-size: 12px; line-height: 18px; color: {t("label3")}">{mono(did, 12, t("label3"))}<span>代码 v{d["code"]}</span><span>配置修订 {d["rev"]}</span><span>表单版本 {d["schema"]}</span></span></div></div>'
            f'<div style="display: flex; align-items: center; gap: 12px"><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: {t("label2")}">启用{switch(d["enabled"], "启用未来触发")}</span>'
            f'{btn("查看执行", "outline", "page", href="Runs.dc.html")}{icon_btn("Ellipsis", "更多操作", 28, t("label2"), href="Retire.dc.html")}</div></header>'
            f'{tabbar}')
    return head


def form_card(title, rows, right='', sub=''):
    s = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{sub}</span>' if sub else ''
    return (f'<section style="box-sizing: border-box; border: 0.5px solid {t("b4")}; border-radius: 20px; background: {t("layer2")}; padding: 8px 20px 4px">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0 6px">'
            f'<div style="display: flex; align-items: baseline; gap: 10px"><h2 style="margin: 0; font-size: 14px; line-height: 22px; font-weight: 500">{title}</h2>{s}</div>{right}</div>'
            f'{rows}</section>')


def definition():
    h = 1940
    d = DEFS['zentao.defects']
    sched = form_card('调度',
                      settings_row('触发方式', '由插件在注册时声明，不能在此更改', tag('轮询', 'neutral'))
                      + settings_row('轮询间隔', '从上一次轮询结束开始计时；未结束的轮询（包括等待输入）不会与下一次重叠',
                                     text_input('10', aria='轮询间隔', width=88) + selector('分钟', '间隔单位', 88))
                      + settings_row('下次轮询', '服务端计算的下一次到期时间', f'<span style="font-size: 14px; line-height: 22px">今天 14:20</span>', last=True))
    execu = form_card('执行',
                      settings_row('并发上限', '此任务同时运行的执行数量，特殊执行和普通执行都会占用名额（全局上限 4）',
                                   text_input('2', aria='并发上限', width=88))
                      + settings_row('Agent 预设', '新触发的执行使用此预设；派发出的普通执行继承来源执行的预设快照', selector('coding · 编码', 'Agent 预设', 220))
                      + settings_row('权限预设', '工具调用的权限模式', selector('工作区内修改', '权限预设', 220))
                      + settings_row('模型', '不选择时使用预设的默认模型', selector('DeepSeek-V4-Flash', '模型', 220))
                      + settings_row('工作目录', '执行的受管工作目录；代码任务在其中创建独立工作树',
                                     text_input('/home/me/tasks/zentao', aria='工作目录', width=300, mono=True), last=True))

    sev = ''.join(pill(lbl, act) for lbl, act in [('1 致命', True), ('2 严重', True), ('3 一般', False), ('4 轻微', False)])
    form_rows = (settings_row('禅道地址', '', text_input('https://zentao.example.com', aria='禅道地址', width=300))
                 + settings_row('产品', '选项由插件实时提供', selector('移动端 App', '产品', 220) + icon_btn('Refresh', '刷新选项', 28, t('label3')))
                 + settings_row('只处理指派给我的缺陷', '', switch(True, '只处理指派给我的缺陷'))
                 + settings_row('严重程度', '可多选', f'<div style="display: flex; gap: 6px">{sev}</div>')
                 + settings_row('Gerrit 仓库', '修复提交到该仓库的评审分支', text_input('mobile-app', aria='Gerrit 仓库', width=220, mono=True))
                 + settings_row('提交前人工确认', '开启后，修复方案需在「待处理」中确认后才会推送', switch(True, '提交前人工确认'))
                 + settings_row('访问令牌', '只保存凭据引用；值只能写入，不会回显',
                                f'{mono("ZENTAO_TOKEN", 12, t("label"))}{tag("已配置", "success")}{btn("替换", "outline", "sm", href="Settings.dc.html")}', last=True))
    json_text = json.dumps({"baseUrl": "https://zentao.example.com", "product": 12, "assignedToMe": True, "severity": [1, 2],
                            "repository": "mobile-app", "confirmBeforePush": True, "token": {"$credential": "ZENTAO_TOKEN"}}, ensure_ascii=False, indent=2)
    json_panel = (f'<div style="padding: 8px 0 16px; display: flex; flex-direction: column; gap: 8px">'
                  f'<pre style="margin: 0; padding: 12px 14px; border-radius: 16px; background: {t("code")}; border: 0.5px solid {t("b2")}; font-family: {MONO}; font-size: 12px; line-height: 19px; color: {t("label")}; white-space: pre-wrap">{esc(json_text)}</pre>'
                  f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">未声明表单的插件（表单版本 0）只提供 JSON 编辑；保存前按插件的 JSON Schema 校验。</span></div>')
    seg_holes = [('{{ modeForm }}', '{{ formBg }}', '{{ formColor }}', '{{ formShadow }}'), ('{{ modeJson }}', '{{ jsonBg }}', '{{ jsonColor }}', '{{ jsonShadow }}')]
    business = form_card('业务配置',
                         f'<sc-if value="{{{{ isForm }}}}" hint-placeholder-val="{{{{ true }}}}">{form_rows}</sc-if>'
                         f'<sc-if value="{{{{ isJson }}}}" hint-placeholder-val="{{{{ false }}}}">{json_panel}</sc-if>',
                         segmented(['表单', 'JSON'], None, '编辑方式', seg_holes), '由插件 zentao.defects 提供 · 表单版本 2')
    check = form_card('配置检查',
                      f'<div style="display: flex; flex-direction: column; gap: 8px; padding: 4px 0 16px">'
                      f'<div style="display: flex; align-items: center; justify-content: space-between"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">保存前可以请插件检查配置，检查不会修改任何数据。</span>{btn("检查配置", "outline", "sm")}</div>'
                      + notice('success', '禅道地址可访问', '找到产品「移动端 App」，当前有 5 个指派给我的缺陷')
                      + notice('warning', '访问令牌将在 12 天后过期', '过期后相关执行会进入「已阻塞」，更新凭据即可恢复')
                      + '</div>', '', '14:09 · 插件返回 2 条提示')
    save_bar = (f'<div style="position: absolute; left: 380px; right: 100px; bottom: 24px; box-sizing: border-box; height: 60px; padding: 0 12px 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; '
                f'border-radius: 20px; background: {t("layer2")}; box-shadow: {elev("prominent")}">'
                f'<span style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: {t("label2")}">{dot("warning")}有 2 项未保存的更改 · 保存后成为配置修订 8，只影响之后的触发</span>'
                f'<span style="display: flex; gap: 8px">{btn("放弃", "ghost", "md")}'
                f'<button type="button" onClick="{{{{ save }}}}" style="box-sizing: border-box; height: 36px; padding: 0 14px; border: 0; border-radius: 12px; background: {t("primary")}; color: {t("fg")}; font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer">保存</button></span></div>')
    toast = (f'<sc-if value="{{{{ saved }}}}" hint-placeholder-val="{{{{ false }}}}"><div role="status" style="position: absolute; top: 24px; left: 50%; transform: translateX(-50%); padding: 10px 16px; border-radius: 12px; '
             f'background: {t("toast")}; color: {t("toastLabel")}; font-size: 13px; line-height: 20px; display: flex; align-items: center; gap: 8px; box-shadow: {elev("panel")}">{icon("Check", 14, 1.3)}已保存 · 配置修订 8</div></sc-if>')
    body_main = (def_header('zentao.defects')
                 + notice('info', '配置变更只影响之后的执行', '进行中的 5 个执行继续使用配置修订 7 的快照；派发出的普通执行继承来源执行的配置。')
                 + sched + execu + business + check)
    logic = f'''class Component extends DCLogic {{
  renderVals() {{
    const s = this.state || {{}};
    const json = s.mode === 'json';
    const on = {{ bg: '{t("layer1")}', color: '{t("label")}', shadow: '{elev("soft")}' }};
    const off = {{ bg: 'transparent', color: '{t("label2")}', shadow: 'none' }};
    const f = json ? off : on;
    const j = json ? on : off;
    return {{
      isForm: !json, isJson: json,
      formBg: f.bg, formColor: f.color, formShadow: f.shadow,
      jsonBg: j.bg, jsonColor: j.color, jsonShadow: j.shadow,
      modeForm: () => this.setState({{ mode: 'form' }}),
      modeJson: () => this.setState({{ mode: 'json' }}),
      saved: !!s.saved,
      save: () => this.setState({{ saved: true }}),
    }};
  }}
}}'''
    return page('任务配置 · 禅道缺陷轮询', root(sidebar('defs', h) + main(body_main, '28px 100px 120px', 20) + save_bar + toast, W, h), W, h, logic)


# ================================================================ Schedule (calendar) config
def schedule():
    h = 1580
    misfire = segmented(['全部补跑', '合并为一次', '跳过'], '合并为一次', '错过的触发')
    overlap = segmented(['排队', '允许并行'], '排队', '重叠策略')
    occ = ''.join(f'<li style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px">{icon("AlarmClock", 14, 1.3, t("label3"))}{esc(x)}</li>'
                  for x in ['10-02 周五 17:00', '10-09 周五 17:00', '10-16 周五 17:00'])
    sched = form_card('调度',
                      settings_row('触发方式', '由插件在注册时声明，不能在此更改', tag('定时', 'neutral'))
                      + settings_row('Cron 表达式', '五段式：分 时 日 月 周',
                                     f'<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px">{text_input("0 17 * * 5", aria="Cron 表达式", width=220, mono=True)}'
                                     f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">每周五 17:00</span></div>')
                      + settings_row('时区', '夏令时重复的时刻取较早一次，不存在的时刻会被跳过并记录', selector('Asia/Shanghai（UTC+08:00）', '时区', 260))
                      + settings_row('错过的触发', '服务停止或机器休眠期间错过多次时：合并为一次执行，并把错过的时间范围交给插件处理', misfire)
                      + settings_row('重叠策略', '上一次执行尚未结束（包括等待输入）时，新的触发排队等待', overlap)
                      + settings_row('接下来的触发', '按所选时区在本地预览，实际以服务端计算的下次触发时间为准',
                                     f'<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px">{occ}</ul>', last=True))
    execu = form_card('执行',
                      settings_row('并发上限', '', text_input('1', aria='并发上限', width=88))
                      + settings_row('Agent 预设', '', selector('writing · 写作', 'Agent 预设', 220))
                      + settings_row('权限预设', '', selector('只读', '权限预设', 220))
                      + settings_row('工作目录', '', text_input('/home/me/tasks/weekly', aria='工作目录', width=300, mono=True), last=True))
    business = form_card('业务配置',
                         settings_row('汇总范围', '', selector('本周一至周五', '汇总范围', 220))
                         + settings_row('周报模板', '选项由插件实时提供', selector('团队周报', '周报模板', 220) + icon_btn('Refresh', '刷新选项', 28, t('label3')))
                         + settings_row('发布前确认', '开启后，周报草稿需要在「待处理」中确认才会发布', switch(True, '发布前确认'))
                         + settings_row('发布凭据', '只保存凭据引用；值只能写入，不会回显',
                                        f'{mono("WEEKLY_REPORT_TOKEN", 12, t("label"))}{tag("未配置", "danger")}{btn("设置", "primary", "sm", href="Settings.dc.html")}', last=True),
                         '', '由插件 report.weekly 提供 · 表单版本 1')
    body_main = (def_header('report.weekly')
                 + notice('error', '发布凭据未配置', '09-26 17:00 的周报执行已阻塞。配置凭据后，在执行详情中补充输入即可唤醒。',
                          btn('打开执行', 'outline', 'sm', href='RunBlocked.dc.html'))
                 + sched + execu + business)
    return page('任务配置 · 周报', root(sidebar('defs', h) + main(body_main, '28px 100px 40px', 20), W, h), W, h)


# ================================================================ Conflict dialog
def conflict():
    h = 900
    bg = main(def_header('zentao.defects') + notice('info', '配置变更只影响之后的执行', '进行中的 5 个执行继续使用配置修订 7 的快照。'), gap=20)
    changes = ''.join(f'<li style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 0.5px solid {t("b2")}; font-size: 13px; line-height: 20px">'
                      f'<span style="color: {t("label2")}">{a}</span><span>{b}</span></li>'
                      for a, b in [('轮询间隔', '10 → 5 分钟'), ('严重程度', '新增「3 一般」')])
    body = (f'<div style="display: flex; flex-direction: column; gap: 4px"><span style="font-size: 12px; line-height: 18px; color: {t("label3")}">你的未保存更改</span>'
            f'<ul style="margin: 0; padding: 0; list-style: none">{changes}</ul></div>'
            + f'<p style="margin: 0; font-size: 12px; line-height: 18px; color: {t("label3")}">重新应用会在修订 8 的基础上合并这些字段，再次提交前你可以检查结果。</p>')
    dlg = dialog('配置已被更新', body,
                 btn('放弃我的更改', 'outline', 'md', href='Definition.dc.html') + btn('在修订 8 上重新应用', 'primary', 'md', href='Definition.dc.html'),
                 460, 'Definition.dc.html',
                 '你基于配置修订 7 编辑，服务端当前已是修订 8。此次保存已被拒绝，没有产生任何更改。')
    return page('配置冲突', root(sidebar('defs', h) + bg + modal_layer(dlg), W, h), W, h)


# ================================================================ Retire dialog
def retire():
    impacts = ''.join(f'<li style="display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px; color: {t("label2")}">'
                      f'<span style="margin-top: 5px">{dot(k)}</span><span>{esc(x)}</span></li>'
                      for k, x in [('error', '立即停止新的触发，并取消该任务全部未完成的执行（当前 3 个）'),
                                   ('idle', '取消完成后清理工作树与临时文件；未提交的代码会先保存为可恢复的产物'),
                                   ('done', '历史执行、会话记录、凭据和共享仓库都会保留')])
    body = (f'<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px">{impacts}</ul>'
            f'<button type="button" onClick="{{{{ toggle }}}}" aria-pressed="{{{{ ack }}}}" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 0.5px solid {t("b3")}; border-radius: 12px; background: transparent; '
            f'font-family: inherit; font-size: 13px; line-height: 20px; color: {t("label")}; text-align: left; cursor: pointer">'
            f'<span aria-hidden="true" style="box-sizing: border-box; width: 16px; height: 16px; flex: none; border-radius: 4px; border: 1px solid {{{{ boxBorder }}}}; background: {{{{ boxBg }}}}; color: {t("fg")}; display: inline-flex; align-items: center; justify-content: center">'
            f'<sc-if value="{{{{ checked }}}}" hint-placeholder-val="{{{{ false }}}}">{icon("Check", 12, 1.6)}</sc-if></span>'
            f'<span>我了解退役会取消这些执行，且不能撤销</span></button>'
            f'<p style="margin: 0; font-size: 12px; line-height: 18px; color: {t("label3")}">退役完成（状态为「已退役」）前，请不要卸载或替换插件代码包。</p>')
    footer = (btn('取消', 'outline', 'md', href='Definitions.dc.html')
              + f'<button type="button" disabled="{{{{ locked }}}}" style="box-sizing: border-box; height: 36px; padding: 0 14px; border: 0; border-radius: 12px; background: {t("red")}; color: rgb(255, 255, 255); '
                f'font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; opacity: {{{{ opacity }}}}">开始退役</button>')
    dlg = dialog('退役「Meegle 需求轮询」', body, footer, 460, 'Definitions.dc.html',
                 '退役用于卸载或升级插件：先关闭准入并完成取消与清理，之后才能安全移除代码。')
    layer = modal_layer(dlg)
    extra_js = f"""    const ack = !!s.ack;
    extra.checked = ack;
    extra.ack = ack ? 'true' : 'false';
    extra.boxBg = ack ? '{t("primary")}' : 'transparent';
    extra.boxBorder = ack ? '{t("primary")}' : '{t("b4")}';
    extra.locked = !ack;
    extra.opacity = ack ? '1' : '0.4';
    extra.toggle = () => this.setState({{ ack: !ack }});"""
    return definitions(layer, '任务', extra_js)


def trigger():
    h = 900
    set_theme(LIGHT)
    bg = main(page_header('概览', '调度器运行中 · 本机任务服务 127.0.0.1:3081', icon_btn('Refresh', '刷新', 28, t('caption'))), gap=24)
    body = (f'<div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">任务</span>'
            f'<button type="button" style="box-sizing: border-box; height: 56px; padding: 0 14px 0 10px; display: flex; align-items: center; gap: 12px; border: 0.5px solid {t("b3")}; border-radius: 16px; background: {t("layer1")}; font-family: inherit; text-align: left; cursor: pointer">'
            f'{tile("Play", 36, 18)}<span style="flex: 1; display: flex; flex-direction: column"><span style="font-size: 14px; line-height: 20px; font-weight: 500; color: {t("label")}">绩效自评</span>'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">review.performance · v0.3.1 · 只列出已启用的手动任务</span></span>{icon("ChevronDown", 14, 1.3, t("label3"))}</button></div>'
            f'<div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">考核周期 <span style="color: {t("red")}">*</span></span>{selector("2026 年第三季度", "考核周期")}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 13px; line-height: 20px; color: {t("label2")}">自评重点</span>'
            + textarea('Q3 完成任务系统后端与网关；推进 Gerrit 提交工具复用。', '列出本周期的主要工作', '自评重点', 3) + '</div>'
            + f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px"><span style="display: flex; flex-direction: column"><span style="font-size: 13px; line-height: 20px; color: {t("label")}">提交前人工审阅</span>'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">草稿会在「待处理」中等待你确认</span></span>{switch(True, "提交前人工审阅")}</div>'
            + f'<p style="margin: 0; font-size: 12px; line-height: 18px; color: {t("label3")}">表单由插件的输入 Schema 生成。触发后可在执行详情中上传附件（单个文件不超过 50 MB）；重复提交同一请求不会创建重复执行。</p>')
    dlg = dialog('手动触发', body, btn('取消', 'outline', 'md', href='Overview.dc.html') + btn('触发', 'primary', 'md', href='RunDetail.dc.html'), 520, 'Overview.dc.html')
    return page('手动触发', root(sidebar('overview', h) + bg + modal_layer(dlg), W, h), W, h)
