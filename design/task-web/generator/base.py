"""Shared tokens and components for the DSH Task web prototype artboards.

Every color, radius, font size and shadow below is copied from the upstream
Web client (packages/client/ui-theme/src/styles, ui-primitives CSS Modules),
so the generated artboards stay on the upstream design language.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CANVAS = Path(__file__).resolve().parents[1] / 'canvas'
ICON_NAMES = ['Search', 'Settings', 'PanelLeft', 'Plus', 'Check', 'ChevronDown', 'ChevronRight', 'ChevronLeft', 'Close', 'Copy',
              'Refresh', 'Trash', 'Warning', 'WarningTriangle', 'User', 'Paperclip', 'Download', 'Play', 'Pause', 'Clock',
              'AlarmClock', 'Gauge', 'Queue', 'Question', 'Info', 'Database', 'Archive', 'CordisPlugin', 'Api', 'FolderClose',
              'Edit', 'Ellipsis', 'Link', 'RightUp', 'Branch', 'Think', 'Goal', 'PluginPinwheel', 'Browse', 'Code',
              'PaperPlane', 'Send', 'StopFill', 'Loading', 'Checklist', 'ListPen', 'Data', 'Light', 'Dark', 'Followsystem']
JSX_ATTRIBUTES = {'strokeWidth=': 'stroke-width=', 'strokeLinecap=': 'stroke-linecap=', 'strokeLinejoin=': 'stroke-linejoin=',
                  'fillRule=': 'fill-rule=', 'clipRule=': 'clip-rule='}


def load_icons():
    """Read icon artwork from the upstream ui-primitives source so artboards use the shipped glyphs."""
    folder = ROOT / 'packages/client/ui-primitives/src/icons'
    src = (folder / 'index.tsx').read_text() + (folder / 'shared-artwork.tsx').read_text()
    icons = {}
    for name in ICON_NAMES:
        match = None
        for pattern in [rf'const (?:Icon)?{name}(?:Outline|Fill)?Artwork\s*=.*?</svg>', rf'function (?:Icon)?{name}(?:Outline|Fill)?Artwork.*?</svg>',
                        rf'export const Icon{name}(?:Outline|Fill)?Regular\s*=.*?</svg>']:
            match = re.search(pattern, src, re.S)
            if match:
                break
        if match is None:
            raise SystemExit(f'upstream icon {name} not found in {folder}')
        svg = re.search(r'<svg.*?</svg>', match.group(0), re.S).group(0)
        box = re.search(r'viewBox="([^"]+)"', svg)
        inner = re.sub(r'\s+', ' ', re.sub(r'<svg[^>]*>', '', svg).replace('</svg>', '')).strip()
        for jsx, attribute in JSX_ATTRIBUTES.items():
            inner = inner.replace(jsx, attribute)
        if '{' in inner:
            raise SystemExit(f'upstream icon {name} contains a JSX expression')
        icons[name] = {'vb': box.group(1) if box else '0 0 16 16', 'inner': inner}
    return icons


ICONS = load_icons()

FONT = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', "
        "'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif")
MONO = ("'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, "
        "'PingFang SC', 'Microsoft YaHei'")

# --dsw-alias-* values resolved per theme (design-platform.css).
LIGHT = dict(
    name='light',
    base='rgb(255, 255, 255)', layer1='rgb(255, 255, 255)', layer2='rgb(255, 255, 255)', layer3='rgb(255, 255, 255)',
    sidebar='rgb(249, 250, 251)', navActive='rgb(235, 238, 242)', navHover='rgb(241, 243, 245)',
    selector='rgb(245, 246, 247)', platform='rgb(245, 246, 247)', overlay='rgb(233, 236, 242)',
    label='rgb(15, 17, 21)', label2='rgb(97, 102, 107)', label3='rgb(129, 133, 140)',
    caption='rgb(173, 178, 184)', dimmed='rgb(225, 229, 238)', fg='rgb(255, 255, 255)',
    b1='rgba(0, 0, 0, 0.04)', b2='rgba(0, 0, 0, 0.1)', b3='rgba(0, 0, 0, 0.12)', b4='rgba(0, 0, 0, 0.16)',
    primary='rgb(15, 17, 21)', ghostActive='rgb(235, 238, 242)', ghostActiveBorder='rgb(151, 157, 166)',
    blue='rgb(65, 118, 230)', blueTint='rgba(65, 118, 230, 0.1)', blue3='rgb(228, 237, 253)',
    green='rgb(34, 197, 94)', greenTint='rgba(34, 197, 94, 0.1)', green3='rgb(230, 250, 237)',
    amber='rgb(245, 158, 11)', amberLabel='rgb(221, 134, 41)', amber2='rgb(247, 173, 49)',
    amberTint='rgba(245, 158, 11, 0.12)', amber3='rgb(254, 245, 231)',
    red='rgb(236, 19, 19)', red2='rgb(242, 90, 90)', redTint='rgba(236, 19, 19, 0.1)', redHover='rgba(236, 19, 19, 0.05)',
    idle='rgb(212, 212, 212)',
    hover='rgba(38, 49, 72, 0.06)', active='rgba(38, 49, 72, 0.1)',
    bubble='rgb(237, 243, 254)', code='rgb(249, 250, 251)', inlineCode='rgb(250, 250, 250)',
    mask='rgba(0, 0, 0, 0.24)', toast='rgb(53, 54, 56)', toastLabel='rgb(255, 255, 255)',
    thumb='rgb(255, 255, 255)', link='rgb(65, 118, 230)', elevStroke='rgba(0, 0, 0, 0.16)',
    deep='rgb(52, 94, 186)',
    diffAddBg='rgb(230, 244, 231)', diffAddMark='rgb(1, 162, 65)', diffDelBg='rgb(252, 230, 226)', diffDelMark='rgb(186, 39, 35)',
    trackOff='rgba(0, 0, 0, 0.12)',
)
DARK = dict(LIGHT)
DARK.update(
    name='dark',
    base='rgb(21, 21, 23)', layer1='rgb(35, 35, 36)', layer2='rgb(44, 44, 46)', layer3='rgb(53, 54, 56)',
    sidebar='rgb(27, 27, 28)', navActive='rgb(67, 69, 74)', navHover='rgb(44, 44, 46)',
    selector='rgb(53, 54, 56)', platform='rgb(53, 54, 56)', overlay='rgb(97, 102, 107)',
    label='rgb(249, 250, 251)', label2='rgb(207, 211, 214)', label3='rgb(173, 178, 184)',
    caption='rgb(129, 133, 140)', dimmed='rgb(67, 69, 74)', fg='rgb(15, 17, 21)',
    b1='rgba(255, 255, 255, 0.06)', b2='rgba(255, 255, 255, 0.12)', b3='rgba(255, 255, 255, 0.16)', b4='rgba(255, 255, 255, 0.2)',
    primary='rgb(249, 250, 251)', ghostActive='rgb(67, 69, 74)', ghostActiveBorder='rgb(129, 133, 140)',
    blue='rgb(122, 170, 255)', blueTint='rgba(122, 170, 255, 0.1)', blue3='rgb(52, 65, 91)',
    green3='rgb(35, 60, 44)', amber3='rgb(39, 36, 31)',
    red='rgb(242, 90, 90)', redTint='rgba(242, 90, 90, 0.1)', redHover='rgba(242, 90, 90, 0.15)',
    idle='rgb(84, 85, 87)',
    hover='rgba(255, 255, 255, 0.08)', active='rgba(255, 255, 255, 0.14)',
    bubble='rgb(44, 44, 46)', code='rgb(27, 27, 28)', inlineCode='rgb(41, 41, 41)',
    mask='rgba(0, 0, 0, 0.5)', toast='rgb(67, 69, 74)',
    thumb='rgb(173, 178, 184)', link='rgb(122, 170, 255)', elevStroke='rgba(255, 255, 255, 0.16)',
    deep='rgb(125, 154, 223)',
    diffAddBg='rgb(31, 49, 36)', diffAddMark='rgb(65, 201, 119)', diffDelBg='rgb(60, 31, 27)', diffDelMark='rgb(250, 66, 62)',
    trackOff='rgba(255, 255, 255, 0.16)',
)


class Theme:
    """Current theme; screens call set_theme() before generating."""
    T = LIGHT


def set_theme(t):
    Theme.T = t


def t(key):
    return Theme.T[key]


def elev(kind='panel', stroke=None):
    s = stroke or t('elevStroke')
    if kind == 'panel':
        return f'0 0 0 0.5px {s}, 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02)'
    if kind == 'prominent':
        return f'0 0 0 0.5px {s}, 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)'
    return f'0 0 0 0.5px {s}, 0 4px 16px 0 rgba(0, 0, 0, 0.03), 0 0 24px 0 rgba(0, 0, 0, 0.03)'


def esc(s):
    return html.escape(str(s), quote=False)


def attr(s):
    return html.escape(str(s), quote=True)


# ---------------------------------------------------------------- icons
def icon(name, size=16, sw=1.3, color=None, style=''):
    ic = ICONS[name]
    inner = re.sub(r'<(path|rect|circle|line|polyline|polygon|ellipse)(\s[^>]*?)?\s*/>', lambda m: f'<{m.group(1)}{m.group(2) or ""}></{m.group(1)}>', ic['inner'])
    c = f'color: {color}; ' if color else ''
    return (f'<svg width="{size}" height="{size}" viewBox="{ic["vb"]}" fill="none" stroke-width="{sw}" '
            f'aria-hidden="true" style="{c}flex: none; {style}">{inner}</svg>')


def mark(size=24):
    """Neutral DSH Task mark: a stroked tile with a check; avoids the DeepSeek whale."""
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex: none; color: {t("label")}">'
            '<rect x="3" y="3" width="18" height="18" rx="6" stroke="currentColor" stroke-width="1.6"></rect>'
            '<path d="M8 12.2L10.8 15L16.2 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>'
            '</svg>')


def spinner(size=14, color=None):
    c = color or t('label3')
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex: none; color: {c}">'
            '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>'
            '<path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>'
            '</svg>')


# ---------------------------------------------------------------- state marks
def dot(state):
    color = {'done': t('green'), 'warning': t('amber'), 'error': t('red'), 'idle': t('idle')}[state]
    return (f'<span aria-hidden="true" style="width: 10px; height: 10px; flex: none; display: inline-flex; align-items: center; justify-content: center">'
            f'<span style="width: 6px; height: 6px; border-radius: 50%; background: {color}"></span></span>')


STATUS = {
    # api value: (zh label, mark, tag tone)
    'provisioning': ('准备中', 'ongoing', 'neutral'),
    'queued': ('排队中', 'idle', 'neutral'),
    'running': ('运行中', 'ongoing', 'info'),
    'waiting_input': ('等待输入', 'warning', 'warning'),
    'waiting_retry': ('等待重试', 'idle', 'neutral'),
    'blocked': ('已阻塞', 'error', 'danger'),
    'recovering': ('恢复中', 'ongoing', 'neutral'),
    'cancelling': ('取消中', 'ongoing', 'neutral'),
    'succeeded': ('已成功', 'done', 'success'),
    'failed': ('已失败', 'error', 'danger'),
    'cancelled': ('已取消', 'idle', 'outline'),
}
TERMINAL = {'succeeded', 'failed', 'cancelled'}
KIND = {'manual': '手动', 'polling': '轮询', 'scheduled': '定时', 'ordinary': '普通执行'}
CLEANUP = {'pending': ('待清理', 'neutral'), 'blocked': ('清理受阻', 'danger'), 'complete': ('已清理', 'quiet')}
SOURCE = {'business': '业务确认', 'tool_approval': '工具审批', 'agent_question': 'Agent 提问'}
RETIRE = {'pending': ('退役中', 'warning'), 'blocked': ('退役受阻', 'danger'), 'complete': ('已退役', 'outline')}
AVAILABILITY = {'active': ('已启用', 'success'), 'paused': ('已暂停', 'outline'), 'blocked': ('调度受阻', 'danger'),
                'retiring': ('退役中', 'warning'), 'retirement_blocked': ('退役受阻', 'danger'),
                'unavailable': ('未安装', 'outline'), 'retired': ('已退役', 'outline')}


def status_mark(status, size=14):
    m = STATUS[status][1]
    if m == 'ongoing':
        return spinner(size, t('blue') if status == 'running' else t('label3'))
    return dot(m)


def tag(text, tone='neutral', mono=False):
    base = ('display: inline-flex; align-items: center; flex: none; border-radius: 999px; padding: 1px 8px; '
            'font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; ')
    if mono:
        base += f'font-family: {MONO}; '
    tones = {
        'success': f'background: {t("greenTint")}; color: {t("green")}',
        'info': f'background: {t("blueTint")}; color: {t("blue")}',
        'warning': f'background: {t("amberTint")}; color: {t("amberLabel")}',
        'danger': f'background: {t("redTint")}; color: {t("red")}',
        'neutral': f'background: {t("platform")}; color: {t("label2")}',
        'outline': f'border: 0.5px solid {t("b4")}; color: {t("label3")}',
        'quiet': f'color: {t("label3")}',
        'solid': f'background: {t("label")}; color: {t("layer3")}',
    }
    return f'<span style="{base}{tones[tone]}">{esc(text)}</span>'


def status_tag(status):
    label, _, tone = STATUS[status]
    return tag(label, tone)


def status_inline(status, extra=''):
    label = STATUS[status][0]
    return (f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; color: {t("label")}; white-space: nowrap">'
            f'{status_mark(status)}<span>{esc(label)}{esc(extra)}</span></span>')


# ---------------------------------------------------------------- controls
def btn(text='', variant='outline', size='sm', ic=None, href=None, aria=None, onclick=None, danger=False, style='', disabled=False, ic_after=None):
    sizes = {
        'sm': 'height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; border-radius: 8px',
        'md': 'height: 36px; padding: 0 14px; font-size: 14px; line-height: 22px; border-radius: 12px',
        'page': 'height: 32px; padding: 0 12px; font-size: 13px; line-height: 20px; border-radius: 12px',
    }
    variants = {
        'primary': f'background: {t("primary")}; color: {t("fg")}; border: 0',
        'danger': f'background: {t("red")}; color: rgb(255, 255, 255); border: 0',
        'outline': f'background: transparent; color: {t("red") if danger else t("label")}; border: 0.5px solid {t("b3")}',
        'ghost': f'background: transparent; color: {t("red") if danger else t("label")}; border: 0',
        'secondary': f'background: {t("selector")}; color: {t("label")}; border: 0',
    }
    s = (f'box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; '
         f'font-family: inherit; font-weight: 400; white-space: nowrap; cursor: pointer; text-decoration: none; '
         f'{sizes[size]}; {variants[variant]}')
    if disabled:
        s += '; opacity: 0.4; cursor: not-allowed'
    if style:
        s += '; ' + style
    inner = ''
    if ic:
        inner += icon(ic, 16 if size != 'sm' else 14, 1.3)
    if text:
        inner += f'<span>{esc(text)}</span>'
    if ic_after:
        inner += icon(ic_after, 14, 1.3)
    a = f' aria-label="{attr(aria)}"' if aria else ''
    o = f' onClick="{onclick}"' if onclick else ''
    d = ' disabled="disabled"' if disabled else ''
    if href:
        return f'<a href="{href}"{a}{o} style="{s}">{inner}</a>'
    return f'<button type="button"{a}{o}{d} style="{s}">{inner}</button>'


def icon_btn(name, aria, size=28, color=None, href=None, onclick=None, sw=1.3):
    c = color or t('label2')
    s = (f'box-sizing: border-box; width: {size}px; height: {size}px; display: inline-flex; align-items: center; justify-content: center; '
         f'flex: none; border: 0; border-radius: 8px; background: transparent; color: {c}; cursor: pointer; padding: 0')
    o = f' onClick="{onclick}"' if onclick else ''
    if href:
        return f'<a href="{href}" aria-label="{attr(aria)}"{o} style="{s}">{icon(name, 16, sw)}</a>'
    return f'<button type="button" aria-label="{attr(aria)}"{o} style="{s}">{icon(name, 16, sw)}</button>'


def switch(on, aria, onclick=None, bound=None):
    """bound: (trackHole, thumbHole) template holes for state-driven switches."""
    if bound:
        track, thumb, checked = bound
        return (f'<button type="button" role="switch" aria-checked="{checked}" aria-label="{attr(aria)}" onClick="{onclick}" '
                f'style="box-sizing: border-box; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; flex: none; cursor: pointer; display: flex; background: {track}">'
                f'<span style="display: block; width: 16px; height: 16px; border-radius: 50%; background: {thumb[0]}; transform: {thumb[1]}"></span></button>')
    track = t('primary') if on else t('trackOff')
    thumb = t('fg') if on else t('thumb')
    tx = 'translateX(16px)' if on else 'none'
    o = f' onClick="{onclick}"' if onclick else ''
    return (f'<button type="button" role="switch" aria-checked="{"true" if on else "false"}" aria-label="{attr(aria)}"{o} '
            f'style="box-sizing: border-box; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; flex: none; cursor: pointer; display: flex; background: {track}">'
            f'<span style="display: block; width: 16px; height: 16px; border-radius: 50%; background: {thumb}; transform: {tx}"></span></button>')


def selector(text, aria=None, width=None, mono=False, muted=False):
    w = f'width: {width}px; ' if width else ''
    f = f'font-family: {MONO}; font-size: 13px; ' if mono else 'font-size: 14px; '
    col = t('label3') if muted else t('label')
    a = f' aria-label="{attr(aria)}"' if aria else ''
    return (f'<button type="button"{a} style="box-sizing: border-box; {w}height: 36px; padding: 0 12px 0 14px; display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; '
            f'border: 0; border-radius: 12px; background: {t("selector")}; color: {col}; font-family: inherit; {f}line-height: 22px; cursor: pointer; white-space: nowrap">'
            f'<span style="overflow: hidden; text-overflow: ellipsis">{esc(text)}</span>{icon("ChevronDown", 14, 1.3, t("label3"))}</button>')


def text_input(value='', placeholder='', aria='', width=None, mono=False, ic=None, height=32, suffix=None, readonly=False):
    w = f'width: {width}px; ' if width else 'width: 100%; '
    f = f'font-family: {MONO}; font-size: 13px; ' if mono else 'font-family: inherit; font-size: 14px; '
    lead = icon(ic, 16, 1.3, t('label3')) if ic else ''
    v = f' value="{attr(value)}"' if value else ''
    p = f' placeholder="{attr(placeholder)}"' if placeholder else ''
    ro = ' readOnly="readOnly"' if readonly else ''
    suf = f'<span style="flex: none; font-size: 13px; line-height: 20px; color: {t("label3")}">{esc(suffix)}</span>' if suffix else ''
    return (f'<label style="box-sizing: border-box; {w}height: {height}px; padding: 0 10px; display: flex; align-items: center; gap: 6px; '
            f'border: 0.5px solid {t("b4")}; border-radius: 12px; background: {t("layer1")}">{lead}'
            f'<input type="text" aria-label="{attr(aria)}"{v}{p}{ro} style="flex: 1; min-width: 0; border: 0; outline: none; background: transparent; padding: 0; color: {t("label")}; {f}line-height: 22px">{suf}</label>')


def textarea(value='', placeholder='', aria='', rows=3, width=None):
    w = f'width: {width}px; ' if width else 'width: 100%; '
    return (f'<textarea aria-label="{attr(aria)}" rows="{rows}" placeholder="{attr(placeholder)}" style="box-sizing: border-box; {w}resize: none; padding: 8px 12px; '
            f'border: 0.5px solid {t("b4")}; border-radius: 16px; background: {t("platform")}; color: {t("label")}; font-family: inherit; font-size: 14px; line-height: 22px; outline: none">{esc(value)}</textarea>')


def segmented(options, selected, aria, holes=None):
    """SegmentedControl: options list of labels; holes: list of (onclick, bg, color, shadow) template holes."""
    items = []
    for i, o in enumerate(options):
        if holes:
            oc, bg, col, sh = holes[i]
            items.append(f'<button type="button" role="tab" onClick="{oc}" style="box-sizing: border-box; height: 28px; padding: 0 16px; border: 0; border-radius: 8px; '
                         f'background: {bg}; color: {col}; box-shadow: {sh}; font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; white-space: nowrap; cursor: pointer">{esc(o)}</button>')
            continue
        sel = o == selected
        bg = t('layer1') if sel else 'transparent'
        col = t('label') if sel else t('label2')
        sh = elev('soft') if sel else 'none'
        items.append(f'<button type="button" role="tab" aria-selected="{"true" if sel else "false"}" style="box-sizing: border-box; height: 28px; padding: 0 16px; border: 0; border-radius: 8px; '
                     f'background: {bg}; color: {col}; box-shadow: {sh}; font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; white-space: nowrap; cursor: pointer">{esc(o)}</button>')
    return (f'<div role="tablist" aria-label="{attr(aria)}" style="display: inline-flex; gap: 2px; padding: 4px; border-radius: 12px; background: {t("hover")}; flex: none">'
            + ''.join(items) + '</div>')


def seg_tabs(options, selected, aria, holes=None, counts=None):
    """SegmentedTabs (page-level, 34px) — holes: list of (onclick, bg, border, weight, color)."""
    items = []
    for i, o in enumerate(options):
        cnt = ''
        if counts and counts.get(o):
            cnt = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; font-weight: 400">{esc(counts[o])}</span>'
        if holes:
            oc, bg, bd, wt, col = holes[i]
            items.append(f'<button type="button" role="tab" onClick="{oc}" style="box-sizing: border-box; height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; '
                         f'border: 0.5px solid {bd}; border-radius: 12px; background: {bg}; color: {col}; font-family: inherit; font-size: 14px; line-height: 20px; font-weight: {wt}; cursor: pointer; white-space: nowrap">'
                         f'<span>{esc(o)}</span>{cnt}</button>')
            continue
        sel = o == selected
        bg = t('layer3') if sel else 'transparent'
        bd = t('b3') if sel else 'transparent'
        wt = 600 if sel else 400
        col = t('label') if sel else t('label2')
        items.append(f'<button type="button" role="tab" aria-selected="{"true" if sel else "false"}" style="box-sizing: border-box; height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; '
                     f'border: 0.5px solid {bd}; border-radius: 12px; background: {bg}; color: {col}; font-family: inherit; font-size: 14px; line-height: 20px; font-weight: {wt}; cursor: pointer; white-space: nowrap">'
                     f'<span>{esc(o)}</span>{cnt}</button>')
    return (f'<div role="tablist" aria-label="{attr(aria)}" style="display: inline-flex; gap: 0; padding: 4px; border-radius: 16px; background: {t("platform")}; flex: none">'
            + ''.join(items) + '</div>')


def pill(text, active=False, onclick=None, holes=None, count=None):
    c = f'<span style="color: {t("label3")}">{esc(count)}</span>' if count is not None else ''
    if holes:
        bg, col, sh = holes
        return (f'<button type="button" onClick="{onclick}" style="box-sizing: border-box; height: 24px; padding: 0 8px; display: inline-flex; align-items: center; gap: 4px; flex: none; '
                f'border: 0; border-radius: 999px; background: {bg}; color: {col}; box-shadow: {sh}; font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap">'
                f'<span>{esc(text)}</span>{c}</button>')
    bg = t('ghostActive') if active else t('layer2')
    col = t('label') if active else t('label2')
    sh = f'inset 0 0 0 1px {t("ghostActiveBorder")}' if active else f'inset 0 0 0 0.5px {t("b3")}'
    o = f' onClick="{onclick}"' if onclick else ''
    return (f'<button type="button"{o} aria-pressed="{"true" if active else "false"}" style="box-sizing: border-box; height: 24px; padding: 0 8px; display: inline-flex; align-items: center; gap: 4px; flex: none; '
            f'border: 0; border-radius: 999px; background: {bg}; color: {col}; box-shadow: {sh}; font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap">'
            f'<span>{esc(text)}</span>{c}</button>')


def mono(text, size=12, color=None):
    c = color or t('label2')
    return f'<span style="font-family: {MONO}; font-size: {size}px; line-height: 18px; color: {c}">{esc(text)}</span>'


def inline_code(text):
    return (f'<code style="font-family: {MONO}; font-size: 12px; line-height: 19px; padding: 1px 5px; border-radius: 4px; '
            f'background: {t("platform")}; color: {t("label")}">{esc(text)}</code>')


def notice(kind, title, body='', actions=''):
    """Inline notice band (state-colored border allowed by the styling rules)."""
    col = {'warning': (t('amber3'), t('amberLabel'), 'WarningTriangle', t('amber2')),
           'error': (t('redTint'), t('red'), 'Warning', t('red2')),
           'info': (t('blue3'), t('blue'), 'Info', t('blueTint')),
           'success': (t('green3'), t('green'), 'Check', t('greenTint'))}[kind]
    b = f'<span style="color: {t("label2")}">{body}</span>' if body else ''
    return (f'<div role="status" style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 16px; background: {col[0]}; font-size: 13px; line-height: 20px">'
            f'{icon(col[2], 16, 1.3, col[1])}<div style="flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px"><span style="color: {col[1]}; font-weight: 500">{esc(title)}</span>{b}</div>{actions}</div>')


def kv(label, value_html, mono_value=False):
    v = f'<span style="font-family: {MONO}; font-size: 12px; line-height: 20px; color: {t("label")}">{value_html}</span>' if mono_value else f'<span style="font-size: 13px; line-height: 20px; color: {t("label")}">{value_html}</span>'
    return (f'<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-height: 28px; padding: 4px 0">'
            f'<span style="flex: none; font-size: 13px; line-height: 20px; color: {t("label3")}">{esc(label)}</span>'
            f'<span style="min-width: 0; text-align: right; overflow-wrap: anywhere">{v}</span></div>')


def section_title(text, count=None, right=''):
    c = f'<span style="font-size: 14px; line-height: 22px; color: {t("caption")}">{esc(count)}</span>' if count is not None else ''
    return (f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 28px">'
            f'<div style="display: flex; align-items: center; gap: 8px"><h2 style="margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; color: {t("label")}">{esc(text)}</h2>{c}</div>{right}</div>')


def card(content, pad='16px 20px', style=''):
    return (f'<section style="box-sizing: border-box; border: 0.5px solid {t("b4")}; border-radius: 20px; background: {t("layer2")}; padding: {pad}; {style}">'
            f'{content}</section>')


def settings_row(label, desc, control, last=False):
    border = '' if last else f'border-bottom: 0.5px solid {t("b2")}; '
    d = f'<div style="font-size: 12px; line-height: 18px; color: {t("label3")}">{desc}</div>' if desc else ''
    return (f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; {border}">'
            f'<div style="min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 24px"><div style="font-size: 14px; line-height: 22px; color: {t("label")}">{label}</div>{d}</div>'
            f'<div style="flex: none; display: flex; align-items: center; gap: 8px">{control}</div></div>')


def tile(name, size=50, isz=22):
    return (f'<span aria-hidden="true" style="box-sizing: border-box; width: {size}px; height: {size}px; flex: none; display: inline-flex; align-items: center; justify-content: center; '
            f'border: 0.5px solid {t("b3")}; border-radius: 16px; background: {t("layer1")}; color: {t("label2")}">{icon(name, isz, 1.3)}</span>')


def file_chip(name, size, kind='TXT'):
    return (f'<div style="box-sizing: border-box; display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border: 0.5px solid {t("b3")}; border-radius: 16px; background: {t("layer1")}; max-width: 300px">'
            f'<span aria-hidden="true" style="width: 28px; height: 28px; flex: none; border-radius: 8px; background: {t("platform")}; color: {t("label2")}; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 10px; font-weight: 500">{esc(kind)}</span>'
            f'<span style="min-width: 0; display: flex; flex-direction: column"><span style="font-size: 13px; line-height: 18px; color: {t("label")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(name)}</span>'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(size)}</span></span></div>')


def progress(frac, color=None, width='100%', height=6):
    c = color or t('primary')
    return (f'<div style="width: {width}; height: {height}px; border-radius: 999px; background: {t("platform")}; overflow: hidden">'
            f'<div style="width: {round(frac * 100)}%; height: 100%; border-radius: 999px; background: {c}"></div></div>')


# ---------------------------------------------------------------- page scaffold
def helmet_css():
    return ('body{margin:0}\n'
            'a{color:inherit;text-decoration:none}\n'
            f'.hv:hover{{background:{t("hover")}}}\n'
            f'.nv:hover{{background:{t("navHover")}}}\n'
            f'.lk:hover{{text-decoration:underline dotted;text-underline-offset:3px}}\n'
            'button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid '
            f'{t("blue")};outline-offset:2px}}\n')


def page(title, body, w, h, logic=None, props=None, lang='zh-CN'):
    props = dict(props or {})
    props['$preview'] = {'width': w, 'height': h}
    pj = json.dumps(props, ensure_ascii=False).replace('&', '&amp;').replace("'", '&#39;')
    logic = logic or 'class Component extends DCLogic {\n  renderVals() {\n    return {};\n  }\n}'
    return f'''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{esc(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
{helmet_css()}</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{pj}'>
{logic}
</script>
</body>
</html>
'''


def root(content, w, h, direction='row', extra=''):
    return (f'<div style="width: {w}px; height: {h}px; box-sizing: border-box; display: flex; flex-direction: {direction}; overflow: hidden; position: relative; '
            f'background: {t("base")}; color: {t("label")}; font-family: {FONT}; font-size: 14px; line-height: 22px; {extra}">{content}</div>')
