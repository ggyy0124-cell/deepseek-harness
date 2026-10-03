"""Run list, run detail variants, inbox, settings and the component sheet."""
import json
from base import *  # noqa: F401,F403
from data import DEFS, OUTCOMES, RUNS, RUN_BY_ID, run_link
from shell import sidebar, main, page_header, modal_layer, dialog, run_header

W = 1440


# ================================================================ helpers: state tabs
def state_tabs(tabs, aria):
    """SegmentedTabs driven by DCLogic state; tabs = [(key, label, count)]."""
    items = ''
    for key, label, count in tabs:
        cnt = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}; font-weight: 400">{esc(count)}</span>' if count else ''
        items += (f'<button type="button" role="tab" aria-selected="{{{{ tab_{key}.sel }}}}" onClick="{{{{ tab_{key}.pick }}}}" '
                  f'style="box-sizing: border-box; height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; border: 0.5px solid {{{{ tab_{key}.bd }}}}; '
                  f'border-radius: 12px; background: {{{{ tab_{key}.bg }}}}; color: {{{{ tab_{key}.color }}}}; font-family: inherit; font-size: 14px; line-height: 20px; '
                  f'font-weight: {{{{ tab_{key}.wt }}}}; cursor: pointer; white-space: nowrap"><span>{esc(label)}</span>{cnt}</button>')
    return f'<div role="tablist" aria-label="{attr(aria)}" style="display: inline-flex; padding: 4px; border-radius: 16px; background: {t("platform")}; flex: none">{items}</div>'


def tabs_js(keys, default):
    return f'''    const cur = s.tab || '{default}';
    const mk = (k) => ({{
      sel: cur === k ? 'true' : 'false',
      bg: cur === k ? '{t("layer3")}' : 'transparent',
      bd: cur === k ? '{t("b3")}' : 'transparent',
      color: cur === k ? '{t("label")}' : '{t("label2")}',
      wt: cur === k ? '600' : '400',
      pick: () => this.setState({{ tab: k }}),
    }});
    extra.show = {{}};
    {json.dumps(keys)}.forEach((k) => {{ extra['tab_' + k] = mk(k); extra.show[k] = cur === k; }});'''


def logic_with(extra_js):
    return ('class Component extends DCLogic {\n  renderVals() {\n    const s = this.state || {};\n    const extra = {};\n'
            + extra_js + '\n    return extra;\n  }\n}')


def panel(key, content, default=False):
    return f'<sc-if value="{{{{ show.{key} }}}}" hint-placeholder-val="{{{{ {"true" if default else "false"} }}}}">{content}</sc-if>'


# ================================================================ transcript atoms
def meta_line(text):
    return (f'<div style="display: flex; align-items: center; gap: 12px; font-size: 12px; line-height: 18px; color: {t("label3")}">'
            f'<span style="flex: 1; height: 0.5px; background: {t("b2")}"></span><span>{text}</span><span style="flex: 1; height: 0.5px; background: {t("b2")}"></span></div>')


def msg_user(text, extra='', who='阶段指令'):
    return (f'<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px">'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(who)}</span>'
            f'<div style="max-width: 525px; padding: 10px 16px; border-radius: 20px; background: {t("bubble")}; font-size: 14px; line-height: 22px; color: {t("label")}">{text}</div>'
            f'{extra}</div>')


def msg_assistant(text):
    return f'<div style="font-size: 14px; line-height: 24px; color: {t("label")}">{text}</div>'


def tool_row(ic, title, summary='', state='done', badge=''):
    col = {'done': t('label2'), 'error': t('red'), 'running': t('label2')}[state]
    lead = spinner(14, t('label3')) if state == 'running' else icon(ic, 14, 1.3, t('label3'))
    summ = f'<span style="min-width: 0; font-family: {MONO}; font-size: 12px; line-height: 18px; color: {t("label3")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{esc(summary)}</span>' if summary else ''
    return (f'<div style="display: flex; align-items: center; gap: 8px; height: 24px">{lead}'
            f'<span style="flex: none; font-size: 13px; line-height: 20px; color: {col}">{esc(title)}</span>{summ}{badge}'
            f'{icon("ChevronRight", 12, 1.3, t("caption"))}</div>')


def think_row(sec):
    return (f'<div style="display: flex; align-items: center; gap: 8px; height: 24px; font-size: 13px; line-height: 20px; color: {t("label3")}">'
            f'{icon("Think", 14, 1.3)}<span>思考 · {sec} 秒</span>{icon("ChevronRight", 12, 1.3, t("caption"))}</div>')


def composer(placeholder, send_label='发送', disabled=False):
    op = 'opacity: 0.4; ' if disabled else ''
    return (f'<div style="flex: none; padding: 0 24px 20px; display: flex; justify-content: center">'
            f'<div style="box-sizing: border-box; width: 100%; max-width: 760px; padding-top: 8px; border-radius: 28px; background: {t("layer2")}; box-shadow: {elev("soft")}; {op}">'
            f'<textarea aria-label="补充输入" rows="2" placeholder="{attr(placeholder)}" style="box-sizing: border-box; width: 100%; resize: none; border: 0; outline: none; background: transparent; '
            f'padding: 4px 8px 0 18px; font-family: inherit; font-size: 14px; line-height: 24px; color: {t("label")}"></textarea>'
            f'<div style="height: 44px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between">'
            f'<div style="display: flex; align-items: center; gap: 4px">{icon_btn("Paperclip", "上传附件", 28, t("label2"))}'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">作为业务输入持久保存，并唤醒执行</span></div>'
            f'<button type="button" aria-label="{attr(send_label)}" style="box-sizing: border-box; width: 28px; height: 28px; border: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; '
            f'background: {t("primary")}; color: {t("fg")}; cursor: pointer; padding: 0">{icon("Send", 16, 1.3)}</button></div></div></div>')


def readonly_bar(text):
    return (f'<div style="flex: none; padding: 0 24px 20px; display: flex; justify-content: center">'
            f'<div role="status" style="box-sizing: border-box; width: 100%; max-width: 760px; padding: 12px 16px; border-radius: 20px; background: {t("platform")}; '
            f'display: flex; align-items: center; gap: 10px; font-size: 13px; line-height: 20px; color: {t("label2")}">{icon("Info", 16, 1, t("label3"))}<span>{text}</span></div></div>')


def info_panel(sections):
    body = ''
    for i, (title, content) in enumerate(sections):
        sep = f'border-top: 0.5px solid {t("b2")}; ' if i else ''
        body += (f'<section style="{sep}padding: 14px 0 10px"><h2 style="margin: 0 0 4px; font-size: 12px; line-height: 18px; font-weight: 500; color: {t("label3")}">{esc(title)}</h2>{content}</section>')
    return (f'<aside aria-label="执行信息" style="width: 320px; flex: none; box-sizing: border-box; height: 100%; overflow: hidden; padding: 6px 20px; border-left: 0.5px solid {t("b3")}; '
            f'background: {t("base")}">{body}</aside>')


def id_row(label, value):
    return (f'<div style="display: flex; flex-direction: column; gap: 2px; padding: 4px 0">'
            f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(label)}</span>'
            f'<span style="display: flex; align-items: center; justify-content: space-between; gap: 8px">{mono(value, 12, t("label"))}{icon_btn("Copy", "复制" + label, 24, t("label3"))}</span></div>')


def run_link_html(rid, label=None):
    r = RUN_BY_ID[rid]
    lbl = label or (r[3] or f'{KIND[r[2]]}执行 · {r[5]}')
    return f'<a href="{run_link(r)}" class="lk" style="color: {t("link")}; font-weight: 500">{esc(lbl)}</a>'


def run_panel(rid, extra_sections=(), times=None, ids=None, rev=12):
    r = RUN_BY_ID[rid]
    d = DEFS[r[1]]
    parent = (run_link_html(r[7], f'轮询执行 {r[7]}') if r[7] and r[7] in RUN_BY_ID else (mono(r[7], 12) if r[7] else '—'))
    outcome = OUTCOMES.get(rid)
    rows = (kv('状态', status_tag(r[4]))
            + (kv('结论', status_tag(outcome)) if outcome and outcome != r[4] else '')
            + (kv('原因', esc(r[9])) if r[9] else '')
            + kv('类型', esc(KIND[r[2]]))
            + (kv('业务键', mono(r[3], 12, t('label'))) if r[3] else '')
            + kv('任务', f'<a href="Definition.dc.html" class="lk" style="color: {t("link")}; font-weight: 500">{esc(d["title"])}</a>')
            + (kv('来源', parent) if r[2] == 'ordinary' else '')
            + kv('配置修订', str(d['rev'])) + kv('代码版本', d['code']) + kv('执行修订', str(rev)))
    tm = times or [('创建', f'09-30 {r[5]}'), ('更新', f'09-30 {r[6]}'), ('计划重试', '—'), ('结束', '—')]
    trows = ''.join(kv(a, esc(b)) for a, b in tm)
    ids = ids or [('执行 ID', f'{rid}-5b0d-4c1e-9f7a-2d6e8b3c1a90'), ('会话 ID', 'task-3f8b21d0-9e4a-4b71-a2c5-0d8e6f1b7c34')]
    irows = ''.join(id_row(a, b) for a, b in ids)
    clean_label, clean_tone = CLEANUP[r[8]]
    cl = kv('清理', tag(clean_label, clean_tone))
    secs = [('执行', rows), ('时间', trows), ('标识', irows), ('资源清理', cl)] + list(extra_sections)
    return info_panel(secs)


def run_shell(rid, header_actions, center, right, h):
    r = RUN_BY_ID[rid]
    body = (f'<div style="flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column">{run_header(r, header_actions)}'
            f'<div style="flex: 1; min-height: 0; display: flex">{center}{right}</div></div>')
    return root(sidebar('runs', h, rid) + body, W, h)


def center_col(tabs_html, content, bottom='', tab_extra=''):
    return (f'<div style="flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column">'
            f'<div style="flex: none; padding: 16px 24px 0; display: flex; justify-content: center"><div style="width: 100%; max-width: 760px; display: flex; align-items: center; justify-content: space-between; gap: 12px">{tabs_html}{tab_extra}</div></div>'
            f'<div style="flex: 1; min-height: 0; overflow: hidden; padding: 20px 24px; display: flex; justify-content: center">'
            f'<div style="width: 100%; max-width: 760px; display: flex; flex-direction: column; gap: 16px">{content}</div></div>{bottom}</div>')


def empty_state(ic, title, body):
    return (f'<div style="padding: 48px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center">'
            f'<span style="width: 40px; height: 40px; border-radius: 12px; background: {t("platform")}; color: {t("label3")}; display: inline-flex; align-items: center; justify-content: center">{icon(ic, 20, 1.3)}</span>'
            f'<span style="font-size: 14px; line-height: 22px; font-weight: 500">{esc(title)}</span>'
            f'<span style="max-width: 360px; font-size: 13px; line-height: 20px; color: {t("label3")}">{body}</span></div>')


def attachments_list(items, can_upload=True, closed='执行已结束，不能再上传附件'):
    rows = ''
    for name, mime, size, digest, created in items:
        rows += (f'<div style="display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 0.5px solid {t("b2")}">'
                 f'<span aria-hidden="true" style="width: 28px; height: 28px; flex: none; border-radius: 8px; background: {t("platform")}; color: {t("label2")}; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 10px; font-weight: 500">{esc(name.rsplit(".", 1)[-1].upper()[:4])}</span>'
                 f'<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-size: 14px; line-height: 20px">{esc(name)}</span>'
                 f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(mime)} · {esc(size)} · sha256 {esc(digest)}…</span></span>'
                 f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(created)}</span>{icon_btn("Download", "下载 " + name, 28, t("label2"))}</div>')
    up = (f'<div style="box-sizing: border-box; height: 72px; border: 1px dashed {t("b4")}; border-radius: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; '
          f'font-size: 13px; line-height: 20px; color: {t("label3")}">{icon("Paperclip", 16, 1.3)}拖放文件或<span style="color: {t("link")}; font-weight: 500">选择文件</span>上传 · 单个不超过 50 MB，每次最多 20 个</div>'
          if can_upload else
          f'<div style="box-sizing: border-box; padding: 12px 16px; border-radius: 16px; background: {t("platform")}; font-size: 13px; line-height: 20px; color: {t("label3")}">{closed}；已有附件仍可下载（支持断点续传）。</div>')
    return f'{up}<div style="display: flex; flex-direction: column">{rows}</div>'


# ================================================================ Runs list
def runs():
    h = 1040
    order = ['7c1e9a42', 'a4f06c3d', '4b8e1d07', '6a3c9f52', '0e6a9b14', 'c81f2a55', '91d7c3e8', '8e3f5b21', '3b9d0f17', 'e2c4b8a1', '5d2b7e90', 'f3a8d261', '2c5e8f07', 'b7c2e4f9', 'd6b41a9c']
    data = []
    for rid in order:
        r = RUN_BY_ID[rid]
        d = DEFS[r[1]]
        label, mk, tone = STATUS[r[4]]
        src = f'轮询 {r[7]}' if r[7] else ''
        cl, ct = CLEANUP[r[8]]
        data.append(dict(id=rid, status=r[4], label=label, mark=mk, name=(r[3] or f'{KIND[r[2]]}执行'), kind=KIND[r[2]],
                         special=r[2] != 'ordinary', defn=d['title'], src=src, created=r[5], updated=r[6],
                         cleanup=cl if r[8] != 'complete' else '', cleanupDanger=r[8] == 'blocked', href=run_link(r)))
    pills = [('all', '全部'), ('running', '运行中'), ('waiting_input', '等待输入'), ('blocked', '已阻塞'), ('queued', '排队中'), ('succeeded', '已成功'), ('failed', '已失败')]
    pill_html = ''.join(pill(lbl, onclick=f'{{{{ p_{k}.pick }}}}', holes=(f'{{{{ p_{k}.bg }}}}', f'{{{{ p_{k}.color }}}}', f'{{{{ p_{k}.shadow }}}}')) for k, lbl in pills)
    more = (f'<button type="button" style="box-sizing: border-box; height: 24px; padding: 0 6px 0 8px; display: inline-flex; align-items: center; gap: 2px; border: 0; border-radius: 999px; '
            f'background: {t("layer2")}; box-shadow: inset 0 0 0 0.5px {t("b3")}; color: {t("label2")}; font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer">更多状态{icon("ChevronDown", 12, 1.3)}</button>')
    filters = (f'<div style="display: flex; flex-direction: column; gap: 12px">'
               f'<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap">{pill_html}{more}</div>'
               f'<div style="display: flex; align-items: center; gap: 8px">{segmented(["全部", "手动", "轮询", "定时", "普通执行"], "全部", "执行类型")}'
               f'<span style="flex: 1"></span>{selector("全部任务", "任务", 160)}'
               f'<div style="width: 220px">{text_input("", "业务键（精确匹配）", "业务键", ic="Search", height=36)}</div>{selector("最近 7 天", "创建时间", 128)}</div></div>')
    head_cells = ''.join(f'<span style="{w}; font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(c)}</span>' for c, w in
                         [('状态', 'width: 112px'), ('执行', 'flex: 1'), ('任务', 'width: 140px'), ('来源', 'width: 124px'), ('创建', 'width: 96px'), ('更新', 'width: 96px'), ('清理', 'width: 64px')])
    rows = (f'<sc-for list="{{{{ rows }}}}" as="r" hint-placeholder-count="10">'
            f'<a href="{{{{ r.href }}}}" class="hv" style="box-sizing: border-box; height: 44px; margin: 0 -12px; padding: 0 12px; display: flex; align-items: center; gap: 12px; border-radius: 12px">'
            f'<span style="width: 112px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px">'
            f'<sc-if value="{{{{ r.ongoing }}}}" hint-placeholder-val="{{{{ false }}}}">{spinner(14, t("label3"))}</sc-if>'
            f'<sc-if value="{{{{ r.dotted }}}}" hint-placeholder-val="{{{{ true }}}}"><span aria-hidden="true" style="width: 10px; height: 10px; flex: none; display: inline-flex; align-items: center; justify-content: center"><span style="width: 6px; height: 6px; border-radius: 50%; background: {{{{ r.dot }}}}"></span></span></sc-if>'
            f'<span>{{{{ r.label }}}}</span></span>'
            f'<span style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px"><span style="font-size: 14px; line-height: 22px; font-weight: 500; white-space: nowrap">{{{{ r.name }}}}</span>'
            f'<sc-if value="{{{{ r.special }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display: inline-flex; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; background: {t("platform")}; color: {t("label2")}">{{{{ r.kind }}}}</span></sc-if>'
            f'<span style="font-family: {MONO}; font-size: 12px; line-height: 18px; color: {t("label3")}">{{{{ r.id }}}}</span></span>'
            f'<span style="width: 140px; font-size: 13px; line-height: 20px; color: {t("label2")}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{{{ r.defn }}}}</span>'
            f'<span style="width: 124px; font-family: {MONO}; font-size: 12px; line-height: 18px; color: {t("label3")}; white-space: nowrap">{{{{ r.src }}}}</span>'
            f'<span style="width: 96px; font-size: 13px; line-height: 20px; color: {t("label2")}; white-space: nowrap">{{{{ r.created }}}}</span>'
            f'<span style="width: 96px; font-size: 13px; line-height: 20px; color: {t("label2")}; white-space: nowrap">{{{{ r.updated }}}}</span>'
            f'<span style="width: 64px; font-size: 12px; line-height: 18px; color: {{{{ r.cleanColor }}}}; white-space: nowrap">{{{{ r.cleanup }}}}</span></a></sc-for>')
    table = (f'<div style="display: flex; flex-direction: column">'
             f'<div style="height: 32px; display: flex; align-items: center; gap: 12px; border-bottom: 0.5px solid {t("b2")}">{head_cells}</div>'
             f'<div style="display: flex; flex-direction: column; padding-top: 4px">{rows}</div>'
             f'<sc-if value="{{{{ empty }}}}" hint-placeholder-val="{{{{ false }}}}">{empty_state("Queue", "没有符合条件的执行", "调整状态、类型或时间范围后重试；筛选按执行的当前状态匹配。")}</sc-if></div>')
    fresh = (f'<div role="status" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: 12px; background: {t("blue3")}; font-size: 13px; line-height: 20px">'
             f'<span style="display: flex; align-items: center; gap: 8px; color: {t("blue")}">{icon("Info", 14, 1)}实时事件：有 2 个新的执行和 3 个状态变化</span>'
             f'<button type="button" style="border: 0; background: transparent; padding: 0; font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; color: {t("link")}; cursor: pointer">刷新列表</button></div>')
    foot = (f'<div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; line-height: 18px; color: {t("label3")}">'
            f'<span>{{{{ countText }}}} · 翻页期间结果集发生变化时，自动从第一页重新加载</span>{btn("加载更多", "outline", "sm")}</div>')
    body_main = (page_header('执行记录', '每次执行拥有独立的会话；按创建时间倒序，状态筛选按当前状态匹配', icon_btn('Refresh', '刷新', 28, t('caption')))
                 + filters + fresh + table + foot)
    ongoing = ['provisioning', 'running', 'recovering', 'cancelling']
    dots = {'done': t('green'), 'warning': t('amber'), 'error': t('red'), 'idle': t('idle')}
    logic = f'''class Component extends DCLogic {{
  renderVals() {{
    const s = this.state || {{}};
    const cur = s.status || 'all';
    const ongoing = {json.dumps(ongoing)};
    const dots = {json.dumps(dots)};
    const all = {json.dumps(data, ensure_ascii=False)};
    const rows = all.filter((r) => cur === 'all' || r.status === cur).map((r) => Object.assign({{}}, r, {{
      ongoing: ongoing.indexOf(r.status) >= 0,
      dotted: ongoing.indexOf(r.status) < 0,
      dot: dots[r.mark] || dots.idle,
      cleanColor: r.cleanupDanger ? '{t("red")}' : '{t("label3")}',
    }}));
    const out = {{ rows, empty: rows.length === 0, countText: '已显示 ' + rows.length + ' 条 · 每页 50 条' }};
    {json.dumps([k for k, _ in pills])}.forEach((k) => {{
      const on = k === cur;
      out['p_' + k] = {{
        bg: on ? '{t("ghostActive")}' : '{t("layer2")}',
        color: on ? '{t("label")}' : '{t("label2")}',
        shadow: on ? 'inset 0 0 0 1px {t("ghostActiveBorder")}' : 'inset 0 0 0 0.5px {t("b3")}',
        pick: () => this.setState({{ status: k }}),
      }};
    }});
    return out;
  }}
}}'''
    return page('执行记录', root(sidebar('runs', h) + main(body_main, gap=16), W, h), W, h, logic)


# ================================================================ Run detail (running)
TABS = [('session', '会话', None), ('interactions', '交互', None), ('result', '结果', None), ('files', '附件', '1'), ('lineage', '关联执行', None)]


def run_detail():
    h = 900
    rid = '7c1e9a42'
    transcript = (meta_line('14:02 · 执行开始 · 阶段「分析」')
                  + msg_user('请分析缺陷 BUG-4821：用户登录约 30 分钟后被强制退出。复现步骤和服务端日志见附件，确认原因后给出修复方案。', file_chip('login-timeout.log', '18 KB', 'LOG'))
                  + think_row(8)
                  + tool_row('Browse', '读取文件', 'src/auth/session.ts')
                  + tool_row('Search', '搜索代码', 'refreshExpiresAt')
                  + msg_assistant(f'原因已定位：{inline_code("refreshExpiresAt")} 写入时以秒为单位，但校验时按毫秒比较，令牌在第一次刷新时就被判定为过期。修复只需统一单位，并补充一条覆盖刷新流程的测试。')
                  + tool_row('Edit', '编辑文件', 'src/auth/session.ts  +3 −1')
                  + tool_row('Api', '运行命令', 'pnpm vitest run src/auth', 'error', tag('退出码 1', 'danger'))
                  + tool_row('Edit', '编辑文件', 'src/auth/session.test.ts  +18')
                  + tool_row('Api', '运行命令', 'pnpm vitest run src/auth', 'running')
                  + f'<div style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: {t("deep")}">{spinner(14, t("deep"))}<span>Agent 正在工作 · 已运行 9 分钟</span></div>')
    center = center_col(state_tabs(TABS, '执行视图'),
                        panel('session', f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>', True)
                        + panel('interactions', empty_state('Question', '没有待处理的交互', '业务确认、工具审批和 Agent 提问会出现在这里，也会汇总到「待处理」。'))
                        + panel('result', empty_state('Checklist', '执行结束后显示结果', '插件在执行成功或失败时提交结构化结果文档。'))
                        + panel('files', attachments_list([('login-timeout.log', 'text/plain', '18 KB', '9c1e4b7a', '14:02')]))
                        + panel('lineage', lineage_block(rid)),
                        composer('补充信息给这次执行，例如新的复现线索…'),
                        f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: {t("label3")}">{dot("done")}会话流已连接</span>')
    right = run_panel(rid)
    actions = btn('取消执行', 'outline', 'page', 'StopFill', danger=True, href='Runs.dc.html') + icon_btn('Ellipsis', '更多操作', 28)
    logic = logic_with(tabs_js([k for k, _, _ in TABS], 'session'))
    return page('执行详情 · BUG-4821', run_shell(rid, actions, center, right, h), W, h, logic)


def lineage_block(rid):
    r = RUN_BY_ID[rid]
    if r[2] == 'ordinary':
        parent = RUN_BY_ID.get(r[7])
        sib = [x for x in RUNS if x[7] == r[7] and x[0] != rid]
        rows = ''.join(f'<div style="display: flex; align-items: center; gap: 10px; height: 40px; border-top: 0.5px solid {t("b2")}">{status_mark(x[4])}'
                       f'{run_link_html(x[0])}<span style="flex: 1"></span>{status_tag(x[4])}</div>' for x in sib)
        return (card(f'<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 12px; line-height: 18px; color: {t("label3")}">来源</span>'
                     f'<div style="display: flex; align-items: center; gap: 10px">{icon("Refresh", 16, 1.3, t("label2"))}'
                     + (run_link_html(parent[0], f'轮询执行 · {parent[5]}') if parent else mono(r[7])) +
                     f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">派发了此执行；来源结束不会影响本执行</span></div></div>')
                + card(f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">同一轮询派发的其他执行</span>{rows}', '14px 20px 6px'))
    return ''


# ================================================================ Run waiting for business input
def interaction_business(stale=False, compact=False):
    opts = [('批准并继续', '按方案实现并提交 Gerrit 变更', True), ('需要修改方案', '在补充说明中写明调整要求', False), ('放弃此需求', '执行会结束并记录原因', False)]
    orows = ''
    for i, (lbl, desc, sel) in enumerate(opts, 1):
        bg = t('hover') if sel else 'transparent'
        bd = t('b2') if sel else 'transparent'
        orows += (f'<button type="button" aria-pressed="{"true" if sel else "false"}" style="box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px 8px 8px; display: flex; align-items: flex-start; gap: 8px; '
                  f'border: 1px solid {bd}; border-radius: 12px; background: {bg}; font-family: inherit; text-align: left; cursor: pointer; color: {t("label")}">'
                  f'<span style="width: 20px; height: 20px; margin-top: 2px; flex: none; border-radius: 4px; background: {t("overlay")}; color: {t("label2")}; display: grid; place-items: center; font-size: 12px; line-height: 18px; font-weight: 500">{i}</span>'
                  f'<span style="display: flex; flex-direction: column"><span style="font-size: 14px; line-height: 24px; font-weight: 500">{lbl}</span>'
                  f'<span style="font-size: 13px; line-height: 20px; color: {t("label3")}">{desc}</span></span></button>')
    feedback = (f'<span style="font-size: 11px; line-height: 16px; color: {t("red")}">此确认已更新为修订 4（需求描述有变化），请查看新内容后再回复</span>' if stale
                else f'<span style="font-size: 11px; line-height: 16px; color: {t("label3")}">修订 3 · 首个有效回复生效</span>')
    action = (btn('查看最新', 'primary', 'md', 'Refresh') if stale else btn('稍后', 'ghost', 'md') + btn('提交回复', 'primary', 'md'))
    strip = f'业务确认 · 需求 REQ-1287 · 22 小时后过期'
    body_opts = '' if compact else f'<div style="padding: 0 16px; display: flex; flex-direction: column; gap: 4px">{orows}</div>'
    custom = '' if compact else (f'<div style="margin: 10px 16px 0">{textarea("", "补充说明（可选）", "补充说明", 2)}</div>')
    return (f'<section aria-label="业务确认" style="box-sizing: border-box; width: 100%; border-radius: 20px; background: {t("layer2")}; box-shadow: {elev("panel", t("b2"))}; overflow: hidden; {"opacity: 1" if not stale else ""}">'
            f'<div style="display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: {t("amber3")}; color: {t("amberLabel")}; font-size: 14px; line-height: 20px">{icon("Question", 16, 1.3)}<span>{strip}</span></div>'
            f'<div style="padding: 14px 16px 12px"><h3 style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 500">确认 REQ-1287 的实现方案</h3>'
            f'<p style="margin: 8px 0 0; font-size: 14px; line-height: 24px; color: {t("label2")}">计划在 {inline_code("reports/export.ts")} 中新增按月导出，复用现有 CSV 生成器；预计修改 4 个文件，并向 {inline_code("release/2.4")} 提交 Gerrit 变更。</p></div>'
            f'{body_opts}{custom}'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 14px">{feedback}<div style="display: flex; gap: 8px">{action}</div></div></section>')


def interaction_tool():
    return (f'<section aria-label="工具审批" style="box-sizing: border-box; width: 100%; border: 1px solid {t("amber2")}; border-radius: 20px; background: {t("layer2")}; overflow: hidden">'
            f'<div style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: {t("amber3")}; color: {t("amberLabel")}; font-size: 13px; line-height: 18px">{icon("WarningTriangle", 14, 1.3)}<span>工具审批 · 需要你的许可</span></div>'
            f'<div style="padding: 12px 16px 0; display: flex; flex-direction: column; gap: 6px"><span style="font-size: 15px; line-height: 24px; font-weight: 500">运行命令</span>'
            f'<span style="font-family: {MONO}; font-size: 13px; line-height: 20px; color: {t("label3")}; word-break: break-all">git push origin HEAD:refs/for/release/2.3</span></div>'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px">'
            f'<span style="font-size: 11px; line-height: 16px; color: {t("label3")}">权限预设「工作区内修改」要求确认网络写入</span>'
            f'<div style="display: flex; gap: 8px">{btn("拒绝", "outline", "md")}{btn("允许一次", "primary", "md")}</div></div></section>')


def interaction_question():
    opts = ['只修复 Android 端', '同时修复 iOS 端', '先只提交分析，不改代码']
    orows = ''.join(f'<button type="button" style="box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px 8px 8px; display: flex; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 12px; '
                    f'background: transparent; font-family: inherit; text-align: left; cursor: pointer; color: {t("label")}">'
                    f'<span style="width: 20px; height: 20px; flex: none; border-radius: 4px; background: {t("overlay")}; color: {t("label2")}; display: grid; place-items: center; font-size: 12px; line-height: 18px; font-weight: 500">{i}</span>'
                    f'<span style="font-size: 14px; line-height: 24px; font-weight: 500">{o}</span></button>' for i, o in enumerate(opts, 1))
    return (f'<section aria-label="Agent 提问" style="box-sizing: border-box; width: 100%; border-radius: 20px; background: {t("layer2")}; box-shadow: {elev("panel", t("b2"))}; overflow: hidden">'
            f'<div style="display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: {t("amber3")}; color: {t("amberLabel")}; font-size: 14px; line-height: 20px">{icon("Question", 16, 1.3)}<span>Agent 提问</span></div>'
            f'<div style="padding: 14px 16px 8px"><h3 style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 500">需求 REQ-1291 同样影响 iOS 端，这次要一起修改吗？</h3></div>'
            f'<div style="padding: 0 16px; display: flex; flex-direction: column; gap: 4px">{orows}</div>'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 14px">'
            f'<span style="font-size: 11px; line-height: 16px; color: {t("label3")}">也可以在执行详情中输入自定义回答</span>{btn("提交回答", "primary", "md")}</div></section>')


def run_interaction():
    h = 1000
    rid = 'a4f06c3d'
    transcript = (meta_line('13:40 · 执行开始 · 阶段「方案」')
                  + msg_user('需求 REQ-1287：报表中心支持按月导出 CSV。请阅读需求与相关代码，给出实现方案，确认后再开始编码。')
                  + think_row(14)
                  + tool_row('Browse', '读取文件', 'reports/export.ts')
                  + tool_row('Search', '搜索代码', 'CsvWriter')
                  + msg_assistant('方案已整理：新增 monthRange 参数并复用 CsvWriter；接口保持兼容。等待你确认后开始实现。')
                  + meta_line('14:08 · 阶段等待业务确认'))
    center = center_col(state_tabs(TABS[:1] + [('interactions', '交互', '1')] + TABS[2:], '执行视图'),
                        panel('session', f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>' , True)
                        + panel('interactions', interaction_business())
                        + panel('result', empty_state('Checklist', '执行结束后显示结果', '插件在执行成功或失败时提交结构化结果文档。'))
                        + panel('files', attachments_list([('prd-export.pdf', 'application/pdf', '1.2 MB', 'e47a0c93', '13:40')]))
                        + panel('lineage', lineage_block(rid)),
                        panel('session', f'<div style="flex: none; padding: 0 24px 20px; display: flex; justify-content: center"><div style="width: 100%; max-width: 760px">{interaction_business()}</div></div>', True))
    right = run_panel(rid, times=[('创建', '09-30 13:40'), ('更新', '09-30 14:08'), ('计划重试', '—'), ('结束', '—')],
                      ids=[('执行 ID', 'a4f06c3d-1e7b-4f20-8c3a-5b9d2e6f0a17'), ('会话 ID', 'task-8d2e4c61-3b0f-4a9e-b7c1-6e5f2a9d0c48')])
    actions = btn('取消执行', 'outline', 'page', 'StopFill', danger=True, href='Runs.dc.html') + icon_btn('Ellipsis', '更多操作', 28)
    logic = logic_with(tabs_js([k for k, _, _ in TABS], 'session'))
    return page('执行详情 · REQ-1287', run_shell(rid, actions, center, right, h), W, h, logic)


# ================================================================ Run result (terminal)
def run_result():
    h = 1240
    rid = 'f3a8d261'
    md = (f'<div style="display: flex; flex-direction: column; gap: 8px"><h3 style="margin: 0; font-size: 18px; line-height: 26px; font-weight: 700">修复摘要</h3>'
          f'<p style="margin: 0; font-size: 14px; line-height: 24px">已修复 BUG-4802：导出 Excel 时中文文件名显示为乱码。原因是响应头 {inline_code("Content-Disposition")} 未按 RFC 5987 编码文件名；现在同时输出 {inline_code("filename")} 与 {inline_code("filename*")}。</p></div>')
    tbl_rows = [('Gerrit 变更', f'<a class="lk" href="RunResult.dc.html" style="color: {t("link")}; font-weight: 500">I8f3c2a1e</a> · 补丁集 2'), ('单元测试', '128 个通过'), ('禅道状态', '已解决 · 已填写解决方案')]
    tbl = ('<table style="width: 100%; border-collapse: collapse; font-size: 13px; line-height: 22px">'
           f'<thead><tr><th scope="col" style="text-align: left; padding: 6px 12px; font-weight: 500; border-bottom: 0.5px solid {t("b3")}; width: 30%">项目</th><th scope="col" style="text-align: left; padding: 6px 12px; font-weight: 500; border-bottom: 0.5px solid {t("b3")}">结果</th></tr></thead><tbody>'
           + ''.join(f'<tr><td style="padding: 6px 12px; border-bottom: 0.5px solid {t("b2")}; color: {t("label2")}">{a}</td><td style="padding: 6px 12px; border-bottom: 0.5px solid {t("b2")}">{b}</td></tr>' for a, b in tbl_rows)
           + '</tbody></table>')
    diff_lines = [(' ', "export function contentDisposition(name: string) {"),
                  ('-', "  return `attachment; filename=\"${name}\"`"),
                  ('+', "  const ascii = name.replace(/[^\\x20-\\x7e]/g, '_')"),
                  ('+', "  return `attachment; filename=\"${ascii}\"; filename*=UTF-8''${encodeURIComponent(name)}`"),
                  (' ', '}')]
    dl = ''
    for sign, line in diff_lines:
        bg = t('diffAddBg') if sign == '+' else (t('diffDelBg') if sign == '-' else 'transparent')
        mk = t('diffAddMark') if sign == '+' else (t('diffDelMark') if sign == '-' else t('label3'))
        dl += (f'<div style="display: flex; background: {bg}; font-family: {MONO}; font-size: 12px; line-height: 19px">'
               f'<span style="width: 24px; flex: none; text-align: center; color: {mk}">{esc(sign)}</span><span style="white-space: pre; color: {t("label")}">{esc(line)}</span></div>')
    diff = (f'<div style="border: 0.5px solid {t("b3")}; border-radius: 16px; overflow: hidden; background: {t("code")}">'
            f'<div style="height: 36px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; line-height: 18px; color: {t("label3")}">'
            f'{mono("src/export/headers.ts", 12, t("label3"))}<span style="display: flex; align-items: center; gap: 4px">{icon("Copy", 14, 1, t("label2"))}</span></div>'
            f'<div style="padding: 4px 0 8px">{dl}</div></div>')
    js = json.dumps({"zentao": {"bug": 4802, "status": "resolved"}, "gerrit": {"change": "I8f3c2a1e", "patchset": 2, "branch": "release/2.3"}}, indent=2)
    json_block = (f'<div style="border: 0.5px solid {t("b3")}; border-radius: 16px; background: {t("code")}; padding: 12px 14px">'
                  f'<pre style="margin: 0; font-family: {MONO}; font-size: 12px; line-height: 19px; color: {t("label")}">{esc(js)}</pre></div>')
    images = (f'<div style="display: flex; gap: 12px">'
              + ''.join(f'<figure style="margin: 0; width: 220px; display: flex; flex-direction: column; gap: 6px">'
                        f'<div style="height: 124px; border-radius: 16px; background: {t("platform")}; border: 0.5px solid {t("b3")}; display: flex; align-items: center; justify-content: center; color: {t("label3")}; font-size: 12px; line-height: 18px">[截图预览]</div>'
                        f'<figcaption style="font-size: 12px; line-height: 18px; color: {t("label3")}">{n}</figcaption></figure>' for n in ['export-before.png · 212 KB', 'export-after.png · 208 KB'])
              + f'<div style="align-self: flex-start">{file_chip("test-report.html", "48 KB", "HTML")}</div></div>')

    def block(label, content):
        return (f'<div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 11px; line-height: 16px; color: {t("caption")}; font-family: {MONO}">{label}</span>{content}</div>')

    result = (notice('success', '执行已成功', '11:47 结束 · 结果由插件以 task-result/v1 文档提交')
              + block('markdown', md) + block('table', tbl) + block('diff', diff) + block('json', json_block) + block('image · file', images))
    transcript = (meta_line('10:12 · 执行开始 · 阶段「分析」')
                  + msg_user('请分析缺陷 BUG-4802：导出的 Excel 文件名为乱码。')
                  + think_row(6) + tool_row('Browse', '读取文件', 'src/export/headers.ts')
                  + msg_assistant('文件名未进行 RFC 5987 编码，浏览器按 Latin-1 解码导致乱码。')
                  + f'<div style="display: flex; align-items: center; gap: 8px; height: 24px; font-size: 13px; line-height: 20px; color: {t("label3")}">{icon("Info", 14, 1)}<span>此消息包含暂不支持显示的内容（类型 audio）</span></div>'
                  + meta_line('11:47 · 执行结束 · 已成功'))
    files = attachments_list([('export-before.png', 'image/png', '212 KB', '3fa90c1d', '10:31'), ('export-after.png', 'image/png', '208 KB', '7bd21e04', '11:40'),
                              ('test-report.html', 'text/html', '48 KB', 'c05e8a92', '11:45')], can_upload=False)
    tabs = [('result', '结果', None), ('session', '会话', None), ('files', '附件', '3'), ('lineage', '关联执行', None)]
    center = center_col(state_tabs(tabs, '执行视图'),
                        panel('result', result, True) + panel('session', f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>')
                        + panel('files', files) + panel('lineage', lineage_block(rid)),
                        readonly_bar('此执行已结束，会话只读：不能再发送输入、回复交互或上传附件。需要继续处理时，由轮询在下次发现时创建新的执行。'))
    right = run_panel(rid, times=[('创建', '09-30 10:12'), ('更新', '09-30 11:47'), ('计划重试', '—'), ('结束', '09-30 11:47')],
                      ids=[('执行 ID', 'f3a8d261-0c4e-4b1a-9d27-8e5f3a6b1c02'), ('会话 ID', 'task-1c9e7a3f-5d2b-4e8c-a0f6-3b7d9e2c5a14')])
    logic = logic_with(tabs_js([k for k, _, _ in tabs], 'result'))
    return page('执行详情 · BUG-4802', run_shell(rid, icon_btn('Ellipsis', '更多操作', 28), center, right, h), W, h, logic)


# ================================================================ Run blocked (scheduled special)
def run_blocked():
    h = 900
    rid = '5d2b7e90'
    banner = (f'<section style="box-sizing: border-box; border: 1px solid {t("red2")}; border-radius: 20px; overflow: hidden; background: {t("layer2")}">'
              f'<div style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: {t("redTint")}; color: {t("red")}; font-size: 13px; line-height: 18px">{icon("Warning", 14, 1.3)}<span>执行已阻塞 · 等待处理后继续</span></div>'
              f'<div style="padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px">'
              f'<span style="font-size: 15px; line-height: 24px; font-weight: 500">凭据 WEEKLY_REPORT_TOKEN 未配置</span>'
              f'<ol style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 22px; color: {t("label2")}"><li>在「设置 › 凭据」中写入 WEEKLY_REPORT_TOKEN（值不会回显）。</li><li>在下方补充一条输入，唤醒执行重新尝试当前阶段；会话和执行 ID 保持不变。</li></ol>'
              f'<div style="display: flex; justify-content: flex-end; gap: 8px">{btn("设置凭据", "primary", "md", href="Settings.dc.html")}</div></div></section>')
    transcript = (meta_line('09-26 17:00 · 定时触发 · 覆盖 09-22 至 09-26')
                  + msg_user('【汇总】请汇总 09-22 至 09-26 的工作记录，按「团队周报」模板生成周报草稿，确认后发布。')
                  + tool_row('Browse', '读取工作记录', '5 天 · 23 条')
                  + msg_assistant('草稿已生成：本周完成 4 项、进行中 2 项、风险 1 项。')
                  + tool_row('Send', '发布周报', 'POST /weekly-reports', 'error', tag('401 未授权', 'danger'))
                  + meta_line('09-26 17:03 · 插件判定为缺少凭据，执行进入「已阻塞」'))
    center = center_col(state_tabs(TABS, '执行视图'),
                        panel('session', banner + f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>', True)
                        + panel('interactions', empty_state('Question', '没有待处理的交互', '阻塞需要你修复外部条件后通过补充输入唤醒。'))
                        + panel('result', empty_state('Checklist', '执行结束后显示结果', '插件在执行成功或失败时提交结构化结果文档。'))
                        + panel('files', attachments_list([('weekly-draft.md', 'text/markdown', '6 KB', '51c7e2a0', '09-26 17:02')]))
                        + panel('lineage', card(f'<span style="font-size: 13px; line-height: 20px; color: {t("label2")}">这是定时触发的特殊执行，没有来源执行；它可以派发普通执行，本次未派发。</span>')),
                        composer('说明已完成的处理，例如「已配置发布凭据，请重试发布」', '唤醒执行'))
    right = run_panel(rid, times=[('计划触发', '09-26 17:00'), ('创建', '09-26 17:00'), ('更新', '09-26 17:03'), ('结束', '—')],
                      ids=[('执行 ID', '5d2b7e90-7a1c-4e3b-8f02-9c6d1e4a7b35'), ('会话 ID', 'task-e0a4b8c2-6f1d-4c3a-9b75-2d8e0f6a3c91')])
    actions = btn('取消执行', 'outline', 'page', 'StopFill', danger=True, href='Runs.dc.html') + icon_btn('Ellipsis', '更多操作', 28)
    logic = logic_with(tabs_js([k for k, _, _ in TABS], 'session'))
    return page('执行详情 · 周报（已阻塞）', run_shell(rid, actions, center, right, h), W, h, logic)


# ================================================================ Run with blocked cleanup
def run_cleanup():
    h = 940
    rid = '2c5e8f07'
    blocked = (f'<section style="box-sizing: border-box; border: 1px solid {t("red2")}; border-radius: 20px; overflow: hidden; background: {t("layer2")}">'
               f'<div style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: {t("redTint")}; color: {t("red")}; font-size: 13px; line-height: 18px">{icon("Warning", 14, 1.3)}<span>资源清理受阻 · 结论已记录为「已失败」</span></div>'
               f'<div style="padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px">'
               f'<span style="font-size: 15px; line-height: 24px; font-weight: 500">插件清理或资源释放没有完成</span>'
               f'<ol style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 22px; color: {t("label2")}">'
               f'<li>在「诊断 › 资源占用」中查看此执行仍占用的资源，修复占用或外部状态。</li>'
               f'<li>点「重试清理」。重试只执行清理，不会重新运行阶段；完成后执行以「已失败」结束，结果保持不变。</li></ol>'
               f'<div style="display: flex; justify-content: flex-end; gap: 8px">{btn("查看诊断", "outline", "md", href="Diagnostics.dc.html")}'
               f'{btn("重试清理", "primary", "md", "Refresh", onclick="{{ retry }}")}</div></div></section>')
    retrying = notice('info', '已受理重试清理', '清理进行中（202），期间状态显示为「取消中」；完成后执行以「已失败」结束。再次失败会回到「已阻塞」，修复后可以继续重试。')
    banner = (f'<sc-if value="{{{{ waiting }}}}" hint-placeholder-val="{{{{ true }}}}">{blocked}</sc-if>'
              f'<sc-if value="{{{{ retrying }}}}" hint-placeholder-val="{{{{ false }}}}">{retrying}</sc-if>')
    transcript = (meta_line('09:31 · 执行开始 · 阶段「实现」')
                  + msg_user('【实现】按已确认的方案实现 REQ-1285：工单导出支持按项目筛选。')
                  + tool_row('Edit', '修改文件', '4 个文件')
                  + tool_row('Code', '运行命令', 'pnpm run build', 'error', tag('退出码 1', 'danger'))
                  + msg_assistant('构建在第 3 次重试后仍然失败：类型检查报告 2 个错误，需要人工确认接口变更。')
                  + meta_line('10:24 · 插件判定执行失败 · 开始清理资源')
                  + meta_line('10:26 · 资源清理失败 · 执行进入「已阻塞」'))
    result = (notice('error', '执行结论：已失败', '结果已记录；清理完成后执行结束，结论与结果不会改变。')
              + card(f'<p style="margin: 0; font-size: 14px; line-height: 24px">构建失败，已达到最大重试次数。类型检查报告 2 个错误，集中在 {inline_code("ExportFilter")} 的接口变更。</p>'))
    tabs = [('session', '会话', None), ('result', '结果', None), ('files', '附件', '1'), ('lineage', '关联执行', None)]
    center = center_col(state_tabs(tabs, '执行视图'),
                        panel('session', banner + f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>', True)
                        + panel('result', result)
                        + panel('files', attachments_list([('build-log.txt', 'text/plain', '86 KB', 'e41c07b9', '10:24')], can_upload=False, closed='结论已记录，不再接受新附件'))
                        + panel('lineage', lineage_block(rid)),
                        readonly_bar('结论已记录，执行只等待资源清理：不能再发送输入或回复交互。'))
    right = run_panel(rid, times=[('创建', '09-30 09:31'), ('更新', '09-30 10:26'), ('结束', '—')],
                      ids=[('执行 ID', '2c5e8f07-4d1b-4a6e-b3c9-5f0a7e2d8c16'), ('会话 ID', 'task-8b2e5c71-0f4a-4d93-a6e1-7c3b9d0f2e58')])
    logic = logic_with(tabs_js([k for k, _, _ in tabs], 'session') + '''
    extra.waiting = !s.retried;
    extra.retrying = !!s.retried;
    extra.retry = () => this.setState({ retried: true });''')
    return page('执行详情 · REQ-1285（清理受阻）', run_shell(rid, icon_btn('Ellipsis', '更多操作', 28), center, right, h), W, h, logic)


# ================================================================ Poll run with lineage
def run_poll():
    h = 900
    rid = '3b9d0f17'
    kids = [x for x in RUNS if x[7] == rid]
    rows = ''.join(f'<a href="{run_link(x)}" class="hv" style="box-sizing: border-box; height: 52px; margin: 0 -12px; padding: 0 12px; display: flex; align-items: center; gap: 12px; border-radius: 12px">'
                   f'<span style="width: 16px; display: inline-flex; justify-content: center">{status_mark(x[4])}</span>'
                   f'<span style="display: flex; flex-direction: column"><span style="font-size: 14px; line-height: 20px; font-weight: 500">{x[3]}</span>{mono(x[0], 12, t("label3"))}</span>'
                   f'<span style="flex: 1"></span>{status_tag(x[4])}<span style="width: 60px; text-align: right; font-size: 12px; line-height: 18px; color: {t("label3")}">{x[5]}</span></a>' for x in kids)
    lineage = (card(section_title('派发的普通执行', len(kids)) + f'<div style="margin-top: 6px; display: flex; flex-direction: column">{rows}</div>', '14px 20px 8px')
               + f'<p style="margin: 0; font-size: 12px; line-height: 18px; color: {t("label3")}">普通执行各自拥有会话，继承此轮询的配置与预设；轮询结束或取消不会影响它们。之后的轮询再次发现同一缺陷时，会关联到仍未结束的执行，而不是重复创建。</p>')
    transcript = (meta_line('14:00 · 轮询触发')
                  + msg_user('【发现】拉取指派给我的缺陷（严重程度 1–2），为每个需要处理的缺陷派发一个普通执行。')
                  + tool_row('Search', '查询禅道', '5 个缺陷 · 3 个需要处理')
                  + tool_row('Branch', '派发执行', 'BUG-4821 · 新建')
                  + tool_row('Branch', '派发执行', 'BUG-4830 · 新建')
                  + tool_row('Branch', '派发执行', 'BUG-4833 · 新建')
                  + msg_assistant('本次轮询派发了 3 个执行；BUG-4817、BUG-4819 已在进行中的执行里处理，无需重复派发。')
                  + meta_line('14:01 · 轮询结束 · 下次 14:20'))
    tabs = [('lineage', '关联执行', str(len(kids))), ('session', '会话', None), ('result', '结果', None)]
    result = card(f'<p style="margin: 0; font-size: 14px; line-height: 24px">发现 5 个缺陷：新建 3 个执行，2 个已有执行继续处理。</p>')
    center = center_col(state_tabs(tabs, '执行视图'),
                        panel('lineage', lineage, True) + panel('session', f'<div style="display: flex; flex-direction: column; gap: 14px">{transcript}</div>') + panel('result', result),
                        readonly_bar('此轮询已结束，会话只读。下次轮询将于 14:20 自动触发。'))
    right = run_panel(rid, times=[('创建', '09-30 14:00'), ('更新', '09-30 14:01'), ('结束', '09-30 14:01'), ('下次轮询', '09-30 14:20')],
                      ids=[('执行 ID', '3b9d0f17-2e8a-4c5d-b1f3-7a0e6c9d4b28'), ('会话 ID', 'task-5f0c3e9a-1b7d-4a2e-8c64-9d3b7e1f0a52')])
    logic = logic_with(tabs_js([k for k, _, _ in tabs], 'lineage'))
    return page('执行详情 · 禅道轮询', run_shell(rid, icon_btn('Ellipsis', '更多操作', 28), center, right, h), W, h, logic)


# ================================================================ Inbox
def inbox():
    h = 980

    def group(rid, content):
        r = RUN_BY_ID[rid]
        d = DEFS[r[1]]
        return (f'<div style="display: flex; flex-direction: column; gap: 8px">'
                f'<div style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px">{status_mark(r[4])}'
                f'<a href="{run_link(r)}" class="lk" style="font-weight: 500; color: {t("label")}">{r[3]}</a><span style="color: {t("label3")}">{d["title"]}</span>'
                f'<span style="flex: 1"></span><a href="{run_link(r)}" class="lk" style="color: {t("link")}; font-weight: 500">打开执行</a></div>{content}</div>')
    seg_holes = [(f'{{{{ f_{k}.pick }}}}', f'{{{{ f_{k}.bg }}}}', f'{{{{ f_{k}.color }}}}', f'{{{{ f_{k}.shadow }}}}') for k in ['all', 'business', 'tool', 'question']]
    seg = segmented(['全部 3', '业务确认 1', '工具审批 1', 'Agent 提问 1'], None, '交互来源', seg_holes)
    body_main = (page_header('待处理', '所有执行中等待你的业务确认、工具审批和 Agent 提问；最先提交的有效回复生效', icon_btn('Refresh', '刷新', 28, t('caption')))
                 + f'<div>{seg}</div>'
                 + f'<div style="display: flex; flex-direction: column; gap: 20px">'
                 + f'<sc-if value="{{{{ show.business }}}}" hint-placeholder-val="{{{{ true }}}}">{group("a4f06c3d", interaction_business(stale=True, compact=True))}</sc-if>'
                 + f'<sc-if value="{{{{ show.tool }}}}" hint-placeholder-val="{{{{ true }}}}">{group("4b8e1d07", interaction_tool())}</sc-if>'
                 + f'<sc-if value="{{{{ show.question }}}}" hint-placeholder-val="{{{{ true }}}}">{group("6a3c9f52", interaction_question())}</sc-if>'
                 + '</div>')
    logic = f'''class Component extends DCLogic {{
  renderVals() {{
    const s = this.state || {{}};
    const cur = s.f || 'all';
    const out = {{ show: {{}} }};
    ['all', 'business', 'tool', 'question'].forEach((k) => {{
      const on = cur === k;
      out['f_' + k] = {{
        bg: on ? '{t("layer1")}' : 'transparent',
        color: on ? '{t("label")}' : '{t("label2")}',
        shadow: on ? '{elev("soft")}' : 'none',
        pick: () => this.setState({{ f: k }}),
      }};
      if (k !== 'all') out.show[k] = cur === 'all' || cur === k;
    }});
    return out;
  }}
}}'''
    return page('待处理', root(sidebar('inbox', h) + main(body_main, '28px 100px 40px', 20), W, h), W, h, logic)


# ================================================================ Settings modal
def settings():
    h = 900
    tabs = [('general', '通用', 'Settings'), ('connection', '连接', 'Link'), ('credentials', '凭据', 'User'), ('devices', '访问令牌', 'Api'), ('about', '关于', 'Info')]
    nav = ''
    for key, label, ic in tabs:
        nav += (f'<button type="button" onClick="{{{{ nav_{key}.pick }}}}" aria-current="{{{{ nav_{key}.cur }}}}" style="box-sizing: border-box; width: 100%; height: 40px; padding: 9px 16px 9px 12px; display: flex; align-items: center; gap: 10px; '
                f'border: 0; border-radius: 12px; background: {{{{ nav_{key}.bg }}}}; color: {t("label")}; font-family: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer">{icon(ic, 16, 1.3)}<span>{label}</span></button>')
    general = (settings_row('语言', '', selector('中文', '语言'))
               + f'<div style="padding: 16px 0 0"><div style="font-size: 14px; line-height: 22px; margin-bottom: 12px">外观</div><div style="display: flex; gap: 8px">'
               + ''.join(f'<a href="{href}" aria-current="{"true" if sel else "false"}" style="box-sizing: border-box; flex: 1; height: 84px; padding: 20px 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border-radius: 20px; '
                         f'border: 0.5px solid {t("caption") if sel else t("b4")}; background: {t("platform") if sel else "transparent"}; font-size: 14px; line-height: 22px; color: {t("label")}">{icon(ic, 16, 1.3)}<span>{lbl}</span></a>'
                         for lbl, ic, sel, href in [('浅色', 'Light', False, 'Main.dc.html'), ('深色', 'Dark', False, 'OverviewDark.dc.html'), ('跟随系统', 'Followsystem', True, 'Main.dc.html')])
               + '</div></div>'
               + settings_row('时间显示', '接口时间均为 UTC；界面按本机时区显示，悬停可查看 UTC 原值', selector('本机时区（UTC+08:00）', '时间显示'), last=True))
    connection = (settings_row('服务地址', '本机任务服务的 API 基址', mono('http://127.0.0.1:3081/api/task/v1', 12, t('label')) + icon_btn('Copy', '复制服务地址', 28, t('label3')))
                  + settings_row('服务状态', '恢复完成且调度器运行时为就绪', tag('就绪', 'success'))
                  + settings_row('实时事件', '断开后自动重连，并从最后收到的游标继续', f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px">{dot("done")}已连接</span>')
                  + settings_row('浏览器会话', '有效期至 10-30 14:02；退出后需要重新通过启动链接登录', btn('退出登录', 'outline', 'md', danger=True))
                  + settings_row('接口描述', '当前服务的 OpenAPI 3.1 文档', btn('打开 openapi.json', 'secondary', 'md', 'RightUp'), last=True))

    def cred(ref, used, configured, writable=True, expanded=False):
        status = tag('已配置', 'success') if configured else tag('未配置', 'danger')
        ctrl = (tag('只读', 'outline') if not writable else (btn('替换', 'outline', 'sm') if configured else btn('设置', 'primary', 'sm')))
        row = (f'<div style="display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 0.5px solid {t("b2")}">'
               f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">{mono(ref, 13, t("label"))}'
               f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{used}</span></div>{status}{ctrl}</div>')
        if expanded:
            row = row.replace(f'border-bottom: 0.5px solid {t("b2")}', 'border-bottom: 0')
            row += (f'<div style="padding: 0 0 16px; border-bottom: 0.5px solid {t("b2")}; display: flex; flex-direction: column; gap: 8px">'
                    f'<label style="box-sizing: border-box; height: 36px; padding: 0 12px; display: flex; align-items: center; border: 0.5px solid {t("blue")}; border-radius: 12px; background: {t("layer1")}">'
                    f'<input type="password" aria-label="WEEKLY_REPORT_TOKEN 新值" placeholder="输入新值" autocomplete="new-password" style="flex: 1; border: 0; outline: none; background: transparent; font-family: inherit; font-size: 14px; line-height: 22px; color: {t("label")}"></label>'
                    f'<div style="display: flex; align-items: center; justify-content: space-between"><span style="font-size: 12px; line-height: 18px; color: {t("label3")}">保存后只显示「已配置」，值不会再次显示，也不会出现在日志中。</span>'
                    f'<span style="display: flex; gap: 8px">{btn("取消", "ghost", "sm")}{btn("保存", "primary", "sm")}</span></div></div>')
        return row
    credentials = (f'<p style="margin: 0 0 4px; font-size: 13px; line-height: 20px; color: {t("label2")}">列表包含已安装任务当前配置引用的全部凭据。任务配置只保存凭据引用；凭据值只能写入，接口只返回是否已配置，执行在每次外部操作时读取当前值。</p>'
                   + cred('WEEKLY_REPORT_TOKEN', '周报', False, expanded=True)
                   + cred('ZENTAO_TOKEN', '禅道缺陷轮询', True)
                   + cred('GERRIT_HTTP_PASSWORD', '禅道缺陷轮询 · Meegle 需求轮询', True)
                   + cred('MEEGLE_TOKEN', 'Meegle 需求轮询', True)
                   + cred('CI_SHARED_TOKEN', '由部署环境提供，界面不能修改', True, writable=False))

    def code(line):
        return (f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 12px; border-radius: 12px; background: {t("code")}; border: 0.5px solid {t("b2")}">'
                f'{mono(line, 12, t("label"))}{icon_btn("Copy", "复制命令", 24, t("label3"))}</div>')
    devices = (f'<div style="display: flex; flex-direction: column; gap: 12px; padding-top: 4px">'
               f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">原生客户端和脚本使用设备令牌（Bearer）访问任务接口。令牌只显示一次，服务端只保存摘要；签发与撤销在本机终端完成：</p>'
               + code('dsh --profile task --token-create') + code('dsh --profile task --token-revoke <设备 ID>')
               + f'<p style="margin: 0; font-size: 12px; line-height: 18px; color: {t("label3")}">浏览器通过启动链接登录，不需要设备令牌；请不要把设备令牌粘贴到网页中。</p></div>')
    about = (settings_row('版本', '', mono('DSH 任务 0.2.0-rc.1-task.0.0.1', 12, t('label')))
             + settings_row('接口版本', '', mono('/api/task/v1', 12, t('label')))
             + settings_row('数据目录', '任务数据库、会话记录和附件', mono('$DSH_HOME/tasks', 12, t('label')))
             + settings_row('备份与恢复', '需先停止任务服务；凭据与外部系统状态不包含在备份中', mono('dsh --profile task --backup <目录>', 12, t('label2')), last=True))
    content = ''
    for key, label, _ in tabs:
        body = {'general': general, 'connection': connection, 'credentials': credentials, 'devices': devices, 'about': about}[key]
        content += (f'<sc-if value="{{{{ show.{key} }}}}" hint-placeholder-val="{{{{ {"true" if key == "credentials" else "false"} }}}}">'
                    f'<h2 style="margin: 0 0 4px; font-size: 16px; line-height: 24px; font-weight: 500">{label}</h2>{body}</sc-if>')
    modal = (f'<div role="dialog" aria-modal="true" aria-label="设置" style="box-sizing: border-box; width: 800px; height: 760px; display: flex; border-radius: 28px; background: {t("layer2")}; box-shadow: {elev("prominent")}; overflow: hidden">'
             f'<nav aria-label="设置分类" style="width: 188px; flex: none; box-sizing: border-box; padding: 22px 12px 0; display: flex; flex-direction: column; gap: 4px">'
             f'<span style="padding: 0 12px 16px; font-size: 16px; line-height: 24px; font-weight: 500">设置</span>{nav}</nav>'
             f'<div style="flex: 1; min-width: 0; box-sizing: border-box; padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 4px">'
             f'<div style="display: flex; justify-content: flex-end">{icon_btn("Close", "关闭设置", 28, t("label2"), href="Overview.dc.html")}</div>{content}</div></div>')
    bg = main(page_header('概览', '调度器运行中 · 本机任务服务 127.0.0.1:3081'), gap=24)
    logic = f'''class Component extends DCLogic {{
  renderVals() {{
    const s = this.state || {{}};
    const cur = s.tab || 'credentials';
    const out = {{ show: {{}} }};
    {json.dumps([k for k, _, _ in tabs])}.forEach((k) => {{
      out['nav_' + k] = {{
        bg: cur === k ? '{t("navActive")}' : 'transparent',
        cur: cur === k ? 'page' : 'false',
        pick: () => this.setState({{ tab: k }}),
      }};
      out.show[k] = cur === k;
    }});
    return out;
  }}
}}'''
    return page('设置', root(sidebar('overview', h) + bg + modal_layer(modal), W, h), W, h, logic)


# ================================================================ Component sheet
def components():
    h = 2420

    def sec(title, content, note=''):
        n = f'<span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{note}</span>' if note else ''
        return (f'<section style="display: flex; flex-direction: column; gap: 12px"><div style="display: flex; align-items: baseline; gap: 12px">'
                f'<h2 style="margin: 0; font-size: 14px; line-height: 22px; font-weight: 500">{title}</h2>{n}</div>{content}</section>')

    status_cells = ''.join(f'<div style="box-sizing: border-box; padding: 12px 14px; border: 0.5px solid {t("b4")}; border-radius: 16px; display: flex; flex-direction: column; gap: 8px">'
                           f'<div style="display: flex; align-items: center; justify-content: space-between">{status_inline(k)}{status_tag(k)}</div>{mono(k, 11, t("label3"))}</div>' for k in STATUS)
    statuses = f'<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px">{status_cells}</div>'

    def tagset(title, pairs):
        return (f'<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{title}</span>'
                f'<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">' + ''.join(pairs) + '</div></div>')
    tags = (f'<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px">'
            + tagset('执行类型 kind', [tag(v, 'neutral' if k != 'ordinary' else 'outline') for k, v in KIND.items()])
            + tagset('资源清理 cleanup', [tag(v[0], v[1]) for v in CLEANUP.values()])
            + tagset('交互来源 source', [tag(v, 'warning') for v in SOURCE.values()])
            + tagset('插件退役 retirement', [tag(v[0], v[1]) for v in RETIRE.values()])
            + tagset('任务可用性 availability', [tag(v[0], v[1]) for v in AVAILABILITY.values()])
            + tagset('执行结论 outcome', [status_tag(k) for k in ('succeeded', 'failed', 'cancelled')])
            + '</div>')
    buttons = (f'<div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center">'
               + btn('主要按钮', 'primary', 'md') + btn('描边按钮', 'outline', 'md') + btn('次要按钮', 'secondary', 'md') + btn('幽灵按钮', 'ghost', 'md')
               + btn('开始退役', 'danger', 'md') + btn('取消执行', 'outline', 'page', 'StopFill', danger=True) + btn('页面操作', 'primary', 'page', 'Plus')
               + btn('小按钮', 'outline', 'sm') + btn('小按钮', 'primary', 'sm') + icon_btn('Refresh', '刷新', 28) + btn('不可用', 'primary', 'md', disabled=True) + '</div>')
    inputs = (f'<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: center">'
              + text_input('https://zentao.example.com', aria='文本输入') + text_input('', '业务键（精确匹配）', '搜索', ic='Search', height=36)
              + f'<div style="display: flex; gap: 8px">{text_input("10", aria="数值", width=88)}{selector("分钟", "单位", 88)}</div>'
              + selector('coding · 编码', 'Agent 预设', 220) + textarea('', '补充说明（可选）', '多行输入', 2)
              + f'<div style="display: flex; gap: 12px; align-items: center">{switch(True, "开")}{switch(False, "关")}{pill("已选中", True)}{pill("未选中")}</div>'
              + f'<div>{segmented(["全部补跑", "合并为一次", "跳过"], "合并为一次", "分段控件")}</div>'
              + f'<div>{seg_tabs(["配置", "执行记录", "生命周期"], "配置", "分段标签", counts={"执行记录": "342"})}</div>'
              + f'<div style="display: flex; gap: 8px">{mono("ZENTAO_TOKEN", 12, t("label"))}{tag("已配置", "success")}{btn("替换", "outline", "sm")}</div>'
              + '</div>')
    conn = ''.join([
        f'<span style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: {t("amber3")}; color: {t("amberLabel")}; font-size: 12px; line-height: 18px">{icon("Refresh", 12, 1.3)}实时事件已断开 · 重试</span>',
        f'<span style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: {t("amber3")}; color: {t("amberLabel")}; font-size: 12px; line-height: 18px">{spinner(12, t("amberLabel"))}正在重新连接…</span>',
        f'<span style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: {t("green3")}; color: {t("green")}; font-size: 12px; line-height: 18px">{icon("Check", 12, 1.3)}已恢复，已补齐错过的事件</span>'])
    toast = (f'<div role="status" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 12px; background: {t("toast")}; color: {t("toastLabel")}; font-size: 13px; line-height: 20px; box-shadow: {elev("panel")}">'
             f'{icon("Check", 14, 1.3)}已保存 · 配置修订 8</div>')
    feedback = (f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
                + notice('info', '配置变更只影响之后的执行', '进行中的执行保留原配置快照。')
                + notice('success', '禅道地址可访问', '插件检查通过。')
                + notice('warning', '存储空间紧张', '可用空间低于 10%，新附件上传可能失败。')
                + notice('error', '会话尚未就绪', '执行仍在准备中（409），稍后自动重试读取会话。')
                + notice('info', '已受理取消', '执行正在停止并清理资源（202）；清理完成前状态保持「取消中」。')
                + notice('warning', '列表已变化', '翻页期间结果集发生变化，已从第一页重新加载。')
                + f'</div><div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center">{conn}{toast}</div>')
    swatches = [('--dsw-alias-label-primary', 'label'), ('--dsw-alias-label-secondary', 'label2'), ('--dsw-alias-label-tertiary', 'label3'), ('--dsw-alias-label-caption', 'caption'),
                ('--dsw-specific-sidebar-fill', 'sidebar'), ('--dsw-specific-sidebar-nav-item-active', 'navActive'), ('--dsw-specific-selector', 'selector'), ('--dsw-alias-border-l3', 'b3'),
                ('--dsw-alias-state-business-primary', 'blue'), ('--dsw-alias-state-success-primary', 'green'), ('--dsw-alias-state-warn-primary', 'amber'), ('--dsw-alias-state-error-primary', 'red')]
    sw = ''.join(f'<div style="display: flex; align-items: center; gap: 10px"><span style="width: 32px; height: 32px; flex: none; border-radius: 8px; background: {t(k)}; box-shadow: inset 0 0 0 0.5px {t("b3")}"></span>'
                 f'<span style="display: flex; flex-direction: column; min-width: 0">{mono(n, 11, t("label"))}{mono(t(k), 11, t("label3"))}</span></div>' for n, k in swatches)
    tokens = f'<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px">{sw}</div>'
    radii = ''.join(f'<div style="display: flex; flex-direction: column; align-items: center; gap: 6px"><span style="width: 72px; height: 72px; border-radius: {r}px; background: {t("platform")}; box-shadow: inset 0 0 0 0.5px {t("b4")}"></span>{mono(f"R{r} · {n}", 11, t("label3"))}</div>'
                    for r, n in [(4, 'xs'), (8, 'sm'), (12, 'md'), (16, 'lg'), (20, 'xl'), (28, 'panel')])
    type_scale = ''.join(f'<div style="display: flex; align-items: baseline; gap: 16px"><span style="width: 120px; flex: none">{mono(spec, 11, t("label3"))}</span><span style="{css}">{sample}</span></div>'
                         for spec, css, sample in [('20/28 · 500', 'font-size: 20px; line-height: 28px; font-weight: 500', '页面标题 执行记录'),
                                                   ('16/24 · 500', 'font-size: 16px; line-height: 24px; font-weight: 500', '对话框标题 手动触发'),
                                                   ('14/22 · 400', 'font-size: 14px; line-height: 22px', '正文 行内容与控件文字'),
                                                   ('13/20 · 400', f'font-size: 13px; line-height: 20px; color: {t("label2")}', '说明文字 副标题与表格'),
                                                   ('12/18 · 400', f'font-size: 12px; line-height: 18px; color: {t("label3")}', '辅助文字 描述与时间'),
                                                   ('11/17 · 500', 'font-size: 11px; line-height: 17px; font-weight: 500', '标签 Tag'),
                                                   ('mono 12/19', f'font-family: {MONO}; font-size: 12px; line-height: 19px', 'task-3f8b21d0 · zentao.defects')])
    body = (f'<header style="display: flex; flex-direction: column; gap: 4px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 500">DSH 任务 · 组件与状态</h1>'
            f'<p style="margin: 0; font-size: 13px; line-height: 20px; color: {t("label2")}">全部取自上游 Web 客户端的 ui-theme 令牌与 ui-primitives 控件规格；括号内为 API 取值。</p></header>'
            + sec('执行状态', statuses, 'status · 11 种')
            + sec('标签', tags)
            + sec('按钮', buttons, 'Button：sm 28 / R8，md 36 / R12；危险确认使用错误色主要按钮')
            + sec('输入与选择', inputs, 'Input 32 / R12 · 选择器 36 / R12 · 开关 36×20 · 分段控件 28 / R8')
            + sec('反馈', feedback, 'Notice R16 · Toast · 实时连接指示')
            + sec('错误与提示', '<div style="display: flex; flex-direction: column">' + ''.join(f'<div style="display: flex; align-items: center; gap: 16px; min-height: 36px; border-top: 0.5px solid {t("b2")}"><span style="width: 260px; flex: none">{mono(c, 12, t("label"))}</span>'f'<span style="width: 260px; flex: none; font-size: 13px; line-height: 20px">{esc(m)}</span><span style="font-size: 12px; line-height: 18px; color: {t("label3")}">{esc(w)}</span></div>' for c, m, w in [('revision_conflict (409)', '配置已被更新', '对话框：放弃或在 currentRevision 上重新应用'), ('stale_interaction (409)', '此确认已更新或已关闭', '交互卡片内提示，按钮变为「查看最新」'), ('read_only (409)', '此执行已结束或只等待清理', '替换输入框的只读提示条'), ('run_readonly (409)', '此执行不再接受附件', '附件区不显示上传入口'), ('invalid_state (409)', '当前状态不允许此操作', '如任务已停用或卸载、清理未受阻；刷新后按最新状态显示'), ('idempotency_conflict (409)', '同一请求已用不同内容提交', '生成新的请求标识后重试'), ('not_found (404)', '找不到该执行或任务', '空状态，提供返回执行记录'), ('invalid_configuration (400)', '配置不符合表单', '字段下方显示错误，保留输入'), ('authentication_required (401)', '浏览器会话已结束', '回到连接页，重新获取启动链接'), ('csrf_rejected (403)', '页面凭据已过期', '重新读取会话后重试写操作'), ('session_unavailable (409)', '会话尚未就绪', '会话与附件区域自动重试'), ('cursor_stale (409)', '列表已变化', '从第一页重新加载'), ('unavailable (503)', '任务服务正在停止', '保持页面，等待服务重新就绪')]) + '</div>', 'RFC 9457 问题详情的 code → 界面呈现')
            + sec('颜色令牌', tokens, '浅色主题取值；深色主题使用同名令牌的深色值')
            + sec('圆角', f'<div style="display: flex; gap: 28px">{radii}</div>', 'ui-radius 标准')
            + sec('字号', f'<div style="display: flex; flex-direction: column; gap: 10px">{type_scale}</div>', '系统字体栈 · 等宽字体栈'))
    return page('组件与状态', root(f'<div style="flex: 1; box-sizing: border-box; padding: 40px 64px; display: flex; flex-direction: column; gap: 32px">{body}</div>', W, h), W, h)
