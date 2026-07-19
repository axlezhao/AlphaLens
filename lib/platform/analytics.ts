import type { AgentCandidate, ArbitrationRubric, ProviderRequest, ProviderRoute, ResearchSkillManifest, WorkflowDefinition } from "./contracts";

export function validateWorkflow(definition: WorkflowDefinition) {
  const errors: string[] = []; const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  if (!nodes.length || nodes.length > 50) errors.push("Workflow 需要 1–50 个节点");
  const ids = new Set<string>();
  for (const node of nodes) { if (!/^[a-z][a-z0-9_-]{1,63}$/.test(node.id)) errors.push(`非法节点 ID：${node.id}`); if (ids.has(node.id)) errors.push(`重复节点：${node.id}`); ids.add(node.id); if (node.type === "agent" && (!node.role?.trim() || !node.objective?.trim())) errors.push(`Agent 节点 ${node.id} 缺少 role/objective`); }
  for (const node of nodes) for (const dependency of node.dependsOn ?? []) if (!ids.has(dependency)) errors.push(`${node.id} 依赖不存在的节点 ${dependency}`);
  const visiting = new Set<string>(); const visited = new Set<string>(); const map = new Map(nodes.map((node) => [node.id, node]));
  function visit(id: string): boolean { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const cyclic = (map.get(id)?.dependsOn ?? []).some(visit); visiting.delete(id); visited.add(id); return cyclic; }
  if (nodes.some((node) => visit(node.id))) errors.push("Workflow DAG 存在循环依赖");
  if (nodes.filter((node) => node.type === "arbitration").length > 1) errors.push("一个版本最多包含一个仲裁节点");
  return { valid: errors.length === 0, errors, nodeCount: nodes.length, parallelRoots: nodes.filter((node) => !(node.dependsOn?.length)).length };
}

export function validateSkillManifest(manifest: ResearchSkillManifest) {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(manifest.name)) errors.push("Skill name 必须是 kebab-case");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push("Skill version 必须是 semver");
  if (!manifest.description?.trim() || manifest.description.length > 500) errors.push("Skill description 不能为空且不超过 500 字符");
  const network = manifest.permissions?.network ?? []; if (network.some((host) => host === "*" || host.includes("://") || host.includes("/"))) errors.push("网络权限必须是明确主机名，禁止通配符和 URL 路径");
  if ((manifest.permissions?.write ?? []).some((scope) => !scope.startsWith("workspace/"))) errors.push("写权限只能位于 workspace/ 命名空间");
  return { valid: errors.length === 0, errors, permissionCount: network.length + (manifest.permissions?.data?.length ?? 0) + (manifest.permissions?.write?.length ?? 0) };
}

export function routeProviders(routes: ProviderRoute[], request: ProviderRequest) {
  const rejected: Array<{ provider: string; reasons: string[] }> = [];
  const eligible = routes.filter((route) => {
    const reasons = [route.capability !== request.capability ? "capability_mismatch" : null, !route.enabled ? "disabled" : null, route.health === "open" || route.health === "disabled" ? `health_${route.health}` : null, !allowed(route.allowedUse, request.use) ? "license_use_not_allowed" : null, request.maxLatencyMs != null && route.latencyMs != null && route.latencyMs > request.maxLatencyMs ? "latency_budget" : null, request.maxCostUsd != null && route.maxCostUsd != null && route.maxCostUsd > request.maxCostUsd ? "cost_budget" : null, request.requireFreshnessSeconds != null && route.freshnessSeconds > request.requireFreshnessSeconds ? "freshness_budget" : null].filter((reason): reason is string => Boolean(reason));
    if (reasons.length) rejected.push({ provider: route.provider, reasons }); return reasons.length === 0;
  }).sort((left, right) => scoreRoute(right) - scoreRoute(left));
  return { selected: eligible[0] ?? null, fallbacks: eligible.slice(1), rejected, explanation: eligible[0] ? `${eligible[0].provider} 满足能力、许可、健康度与预算约束，综合优先级最高。` : "没有 Provider 同时满足能力、许可、健康度与预算约束；必须降级或补充授权。" };
}

export function arbitrateCandidates(candidates: AgentCandidate[], rubric: ArbitrationRubric = defaultRubric) {
  if (!candidates.length) return { winner: null, scores: [], confidence: 0, explanation: ["没有可仲裁候选结果。"], dissent: [] };
  const weightTotal = Object.values(rubric).reduce((sum, value) => sum + value, 0) || 1;
  const scores = candidates.map((candidate) => { const dimensions = { evidenceCoverage: bounded(candidate.evidenceCount / 8), sourceAuthority: bounded(candidate.primarySourceCount / Math.max(1, candidate.evidenceCount)), contradictionHandling: bounded(candidate.contradictionsAddressed / 3), freshness: bounded(1 - candidate.staleSourceCount / Math.max(1, candidate.evidenceCount)), reasoningClarity: bounded(candidate.reasoningSignals / 5) }; const total = Object.entries(dimensions).reduce((sum, [key, value]) => sum + value * rubric[key as keyof ArbitrationRubric], 0) / weightTotal; return { id: candidate.id, role: candidate.role, total, dimensions }; }).sort((left, right) => right.total - left.total);
  const winner = scores[0]; const runnerUp = scores[1]; const margin = runnerUp ? winner.total - runnerUp.total : winner.total; const dissent = scores.slice(1).filter((item) => item.total >= winner.total - .12).map((item) => ({ id: item.id, role: item.role, score: item.total, reason: "候选结论接近，应保留为少数意见供人工复核。" }));
  return { winner, scores, confidence: bounded(.55 + margin), explanation: [`${winner.role} 在证据覆盖、来源权威、反证处理、新鲜度和推理清晰度的加权评分最高。`, margin < .08 ? "领先幅度较小，必须人工复核，不能将仲裁视为事实判定。" : "领先幅度达到自动推荐阈值，但仍需审批后发布。"], dissent };
}

export function explainQuality(input: { citations: number; primaryCitations: number; contradictions: number; staleSources: number; unsupportedClaims: number; leakageViolations: number }) {
  const dimensions = { evidenceCoverage: bounded(input.citations / 10), sourceAuthority: bounded(input.primaryCitations / Math.max(1, input.citations)), contradictionCoverage: bounded(input.contradictions / 3), freshness: bounded(1 - input.staleSources / Math.max(1, input.citations)), groundedness: bounded(1 - input.unsupportedClaims / Math.max(1, input.citations)), temporalIntegrity: input.leakageViolations ? 0 : 1 };
  const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.values(dimensions).length;
  const failures = Object.entries(dimensions).filter(([, value]) => value < .6).map(([key, value]) => ({ dimension: key, score: value, explanation: qualityExplanation(key) }));
  return { score, passed: score >= .75 && input.leakageViolations === 0, dimensions, failures };
}

export const defaultRubric: ArbitrationRubric = { evidenceCoverage: .25, sourceAuthority: .25, contradictionHandling: .2, freshness: .15, reasoningClarity: .15 };
function scoreRoute(route: ProviderRoute) { return (1000 - route.priority * 5) + (route.health === "healthy" ? 100 : route.health === "degraded" ? 20 : 50) - (route.latencyMs ?? 0) / 100 - (route.maxCostUsd ?? 0) * 10; }
function allowed(value: string, use: ProviderRequest["use"]) { return value.split(",").map((item) => item.trim()).includes(use) || value === "all"; }
function bounded(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function qualityExplanation(key: string) { return ({ evidenceCoverage: "关键结论缺少足够证据节点。", sourceAuthority: "第一方或权威来源占比不足。", contradictionCoverage: "没有充分处理反方证据和来源冲突。", freshness: "陈旧来源占比过高。", groundedness: "存在无法回到证据的结论。", temporalIntegrity: "检测到 as_of 之后的数据，存在时间穿越。" } as Record<string, string>)[key] ?? "质量维度未达标。"; }
