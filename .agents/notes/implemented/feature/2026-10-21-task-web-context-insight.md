# Agent Note: Context insight in Task Web from the dsh-context plugin

Status: implemented

English | [中文](2026-10-21-task-web-context-insight.zh.md)

## Problem

Tuning a Task means knowing what the model's context is made of: how much the system prompt and tool schemas cost, how tool results pile up, when a compaction happened, which files the Agent read and wrote. DSH Web users get this from the third-party [dsh-context](https://www.npmjs.com/package/dsh-context) plugin, whose host half folds the Session log through Session projection units and whose browser half adds Context tabs, a sidebar panel and an insights page to DSH Web. Task Web is a separate Vite application with no Cordis client loader and none of the DSH Web Session, sidebar and settings services that the browser half plugs into, so the plugin cannot simply be installed there. The plugin's own HTTP routes also need the DSH Web `connection` service, which the Task Profile does not compose.

## Decision

The Task host loads only the plugin's host half, installed the normal way with `dsh plugin --profile task add dsh-context`; the harness ships no copy and adds no dependency. Its units register on the Task host's projection registry, which the Task Profile already composes, and the plugin's own routes stay absent because their `connection` inject never resolves. The system-prompt prefix and suffix sections it registers are empty by default, and the prompt assembler drops empty sections, so Task Agents' prompts do not change.

`GET /runs/{runId}/context` (`getRunContext`) folds the Run's stored Session through the registered units with the Run statistics' cold read and per-Run fold cache, and returns the plugin's `contextTimeline` and `contextHeaders` views by key as JSON, unchanged. Without the plugin there is no `contextTimeline` value and the route answers `404 context_unavailable`.

Task Web adds a Context view beside the trajectory. It validates the fields it reads with lenient schemas that ignore unknown fields, so newer plugin versions keep working while they add fields, and shows an explicit incompatibility notice when a field it reads changes shape. It renders its own cards in Task Web components: overview, current context, per-request trend with compaction and prune markers, context events, file activity and tools. A host without the plugin shows the install command.

## Alternatives considered

**Load the plugin's browser half in Task Web.** Rejected: Task Web has no client plugin loader, and the browser half depends on DSH Web services that Task Web does not run; shimming them would couple Task Web to the plugin's internal integration points.

**Reimplement the context folds in the Task gateway.** Rejected: the plugin's folds track many harness event shapes and are maintained upstream; a copy would drift. Reading its projection values reuses that work and stays optional.

**Bundle dsh-context into the Task application.** Rejected for now: it would pin a third-party package into the harness release and force its prompt hooks on every Task host. Installing it per profile keeps the choice with the operator.

**Serve every projection value of the Session.** Rejected: the route would expose whatever any installed plugin registers. Reading the two named keys keeps the contract explicit.

## Consequences

Task Web shows context insight for any Run once dsh-context is installed on the host; without it nothing else changes. The view reads the plugin's wire format, so a plugin release that reshapes a field the view reads shows the incompatibility notice until Task Web follows; the specs read a fixture produced by dsh-context 0.74.0. The cached fold now also holds the plugin's state, which is larger than the statistics' state, within the same `statsCacheRuns` bound. The per-request content browser, cross-Run insights and the agent network of DSH Web are not provided.
