"""Application frame shared by every in-app artboard: sidebar, entry-page header, modal layer."""
from base import *  # noqa: F401,F403
from data import DEFS, RUN_BY_ID, ACTIVE, run_link

NAV = [
    ('overview', '概览', 'Gauge', 'Overview.dc.html'),
    ('defs', '任务', 'ListPen', 'Definitions.dc.html'),
    ('runs', '执行记录', 'Queue', 'Runs.dc.html'),
    ('inbox', '待处理', 'Question', 'Inbox.dc.html'),
    ('diag', '诊断', 'Data', 'Diagnostics.dc.html'),
]


def nav_row(key, label, ic, href, active, badge=None):
    bg = t('navActive') if active else 'transparent'
    b = f'<span style="margin-left: auto">{tag(badge, "warning")}</span>' if badge else ''
    cur = ' aria-current="page"' if active else ''
    cls = '' if active else ' class="nv"'
    return (f'<a href="{href}"{cur}{cls} style="box-sizing: border-box; height: 36px; padding: 7px 8px; display: flex; align-items: center; gap: 14px; '
            f'border-radius: 12px; background: {bg}; color: {t("label")}; font-size: 14px; line-height: 22px">'
            f'{icon(ic, 16, 1.3, t("label"))}<span>{esc(label)}</span>{b}</a>')


def run_row(rid, active_id=None):
    r = RUN_BY_ID[rid]
    d = DEFS[r[1]]
    title = f'{r[3]} · {d["short"]}' if r[3] else f'{d["title"]} · {r[5]}'
    active = rid == active_id
    bg = t('navActive') if active else 'transparent'
    cls = '' if active else ' class="nv"'
    return (f'<a href="{run_link(r)}"{cls} style="box-sizing: border-box; height: 32px; padding: 0 8px; display: flex; align-items: center; gap: 10px; border-radius: 12px; background: {bg}; color: {t("label")}">'
            f'<span style="width: 16px; flex: none; display: inline-flex; justify-content: center">{status_mark(r[4])}</span>'
            f'<span style="flex: 1; min-width: 0; font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(title)}</span>'
            f'<span style="flex: none; font-size: 12px; line-height: 18px; color: {t("caption")}">{esc(r[6])}</span></a>')


def sidebar(active, h, run_active=None):
    rows = ''.join(nav_row(k, l, i, hr, k == active, '3' if k == 'inbox' else None) for k, l, i, hr in NAV)
    runs = ''.join(run_row(r, run_active) for r in ACTIVE)
    return (
        f'<nav aria-label="主导航" style="width: 280px; height: {h}px; flex: none; box-sizing: border-box; padding: 6px 12px; display: flex; flex-direction: column; '
        f'background: {t("sidebar")}; border-right: 0.5px solid {t("b3")}">'
        # brand row
        f'<div style="height: 48px; box-sizing: border-box; padding: 18px 4px 6px; display: flex; align-items: center; justify-content: space-between">'
        f'<a href="Overview.dc.html" style="display: flex; align-items: center; gap: 6px">{mark(24)}'
        f'<span style="font-size: 18px; line-height: 24px; font-weight: 600; color: {t("label")}">DSH 任务</span></a>'
        f'{icon_btn("PanelLeft", "收起侧栏", 28, t("label2"))}</div>'
        # primary action
        f'<a href="Trigger.dc.html" style="box-sizing: border-box; margin-top: 16px; height: 38px; padding: 8px 12px; display: flex; align-items: center; justify-content: center; gap: 6px; '
        f'border: 0.5px solid {t("b3")}; border-radius: 12px; background: {t("layer1")}; color: {t("label")}; font-size: 14px; line-height: 22px; font-weight: 500">'
        f'{icon("Play", 16, 1.3)}<span>手动触发</span></a>'
        f'<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 2px">{rows}</div>'
        # active runs, the Task analogue of the session list
        f'<div style="margin-top: 16px; height: 36px; padding-left: 4px; display: flex; align-items: center; justify-content: space-between">'
        f'<span style="font-size: 14px; line-height: 20px; color: {t("caption")}">进行中 · {len(ACTIVE)}</span>'
        f'{icon_btn("ChevronRight", "查看全部进行中的执行", 28, t("caption"), href="Runs.dc.html")}</div>'
        f'<div style="display: flex; flex-direction: column; gap: 2px">{runs}</div>'
        f'<div style="flex: 1"></div>'
        f'<a href="Settings.dc.html" class="nv" style="box-sizing: border-box; height: 42px; padding: 0 10px 0 8px; display: flex; align-items: center; gap: 14px; border-radius: 12px; color: {t("label")}; font-size: 14px; line-height: 22px">'
        f'{icon("Settings", 16, 1.3)}<span>设置</span></a>'
        f'</nav>')


def main(content, pad='28px 100px 40px', gap=28, extra=''):
    return (f'<main style="flex: 1; min-width: 0; height: 100%; box-sizing: border-box; overflow: hidden; padding: {pad}; '
            f'display: flex; flex-direction: column; gap: {gap}px; {extra}">{content}</main>')


def page_header(title, subtitle='', actions='', crumbs=None):
    c = ''
    if crumbs:
        parts = []
        for label, href in crumbs:
            parts.append(f'<a href="{href}" class="lk" style="color: {t("label3")}">{esc(label)}</a>')
        c = (f'<div style="display: flex; align-items: center; gap: 4px; font-size: 13px; line-height: 20px">'
             + f'{icon("ChevronRight", 12, 1.3, t("caption"))}'.join(parts) + '</div>')
    s = f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">{subtitle}</p>' if subtitle else ''
    return (f'<header style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">'
            f'<div style="min-width: 0; display: flex; flex-direction: column; gap: 4px">{c}'
            f'<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; color: {t("label")}">{esc(title)}</h1>{s}</div>'
            f'<div style="flex: none; display: flex; align-items: center; gap: 8px; padding-top: {24 if crumbs else 0}px">{actions}</div></header>')


def modal_layer(dialog, w=None):
    """Upstream Modal: full-frame layer, dark mask without blur, centered R28 dialog."""
    return (f'<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: {t("mask")}; z-index: 10">'
            f'{dialog}</div>')


def dialog(title, body, footer, width=380, close_href=None, description=''):
    close = icon_btn('Close', '关闭', 28, t('label2'), href=close_href) if close_href else icon_btn('Close', '关闭', 28, t('label2'))
    d = f'<p style="margin: 0; padding: 0 24px; font-size: 14px; line-height: 22px; color: {t("label")}">{description}</p>' if description else ''
    return (f'<div role="dialog" aria-modal="true" aria-label="{attr(title)}" style="box-sizing: border-box; width: {width}px; display: flex; flex-direction: column; gap: 20px; '
            f'padding: 0 0 24px; border-radius: 28px; background: {t("layer2")}; box-shadow: {elev("prominent")}; overflow: hidden">'
            f'<div style="display: flex; flex-direction: column">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px">'
            f'<h2 style="margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: {t("label")}">{esc(title)}</h2>{close}</div>{d}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 16px; padding: 0 24px">{body}</div>'
            f'<div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px">{footer}</div></div>')


def run_header(r, actions=''):
    """Conversation-style header for a Run: crumb, title, status, actions."""
    d = DEFS[r[1]]
    name = r[3] if r[3] else f'{KIND[r[2]]}执行 · {r[5]}'
    return (f'<header style="height: 56px; flex: none; box-sizing: border-box; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; '
            f'border-bottom: 0.5px solid {t("b3")}">'
            f'<div style="min-width: 0; display: flex; align-items: center; gap: 8px">'
            f'<a href="Runs.dc.html" class="lk" style="font-size: 14px; line-height: 22px; color: {t("label3")}">执行记录</a>{icon("ChevronRight", 12, 1.3, t("caption"))}'
            f'<a href="Definition.dc.html" class="lk" style="font-size: 14px; line-height: 22px; color: {t("label3")}">{esc(d["title"])}</a>{icon("ChevronRight", 12, 1.3, t("caption"))}'
            f'<h1 style="margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; color: {t("label")}; white-space: nowrap">{esc(name)}</h1>'
            f'{status_tag(r[4])}{tag(KIND[r[2]], "outline")}</div>'
            f'<div style="flex: none; display: flex; align-items: center; gap: 8px">{actions}</div></header>')
