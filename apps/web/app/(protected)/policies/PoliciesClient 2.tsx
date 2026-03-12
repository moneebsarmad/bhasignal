"use client";

import { FormEvent, useEffect, useState } from "react";

interface PolicyTemplate {
  label: string;
  dueDays: number;
  assignedTo: string | null;
  notesTemplate: string;
}

interface PolicyRow {
  version: number;
  baseThreshold: number;
  warningOffsets: number[];
  milestones: number[];
  interventionTemplates: string;
  createdBy: string;
  createdAt: string;
  parsedTemplates?: PolicyTemplate[];
}

interface PolicyResponse {
  latest: PolicyRow | null;
  policies: PolicyRow[];
}

export function PoliciesClient() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [latest, setLatest] = useState<PolicyRow | null>(null);
  const [baseThreshold, setBaseThreshold] = useState("");
  const [warningOffsets, setWarningOffsets] = useState("");
  const [milestones, setMilestones] = useState("");
  const [templatesJson, setTemplatesJson] = useState("[]");
  const [queueNotifications, setQueueNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPolicies() {
    setIsLoading(true);
    const response = await fetch("/api/policies", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as PolicyResponse | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Could not load policies.");
      setIsLoading(false);
      return;
    }

    const payload = body as PolicyResponse;
    setPolicies(payload.policies || []);
    setLatest(payload.latest || null);
    setError(null);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  async function onCreatePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSaving(true);

    let parsedTemplates: unknown = [];
    try {
      parsedTemplates = JSON.parse(templatesJson);
    } catch {
      setError("Templates JSON is invalid.");
      setIsSaving(false);
      return;
    }

    const payload = {
      baseThreshold: Number(baseThreshold),
      warningOffsets: warningOffsets
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
      milestones: milestones
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
      interventionTemplates: parsedTemplates
    };

    const response = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = (await response.json().catch(() => null)) as { error?: string; policy?: PolicyRow } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to create policy.");
      setIsSaving(false);
      return;
    }

    setMessage(`Policy version ${body?.policy?.version ?? ""} created.`);
    await loadPolicies();
    setIsSaving(false);
  }

  async function onEvaluatePolicy() {
    setError(null);
    setMessage(null);
    setIsEvaluating(true);

    const response = await fetch("/api/policies/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyVersion: latest?.version,
        queueNotifications
      })
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string; evaluation?: { triggeredInterventions: number; reopenedInterventions: number; closedInterventions: number; policyVersion: number }; queueSummary?: { queued: number } }
      | null;
    if (!response.ok) {
      setError(body?.error || "Policy evaluation failed.");
      setIsEvaluating(false);
      return;
    }

    setMessage(
      `Policy v${body?.evaluation?.policyVersion ?? ""} evaluated. Created ${body?.evaluation?.triggeredInterventions ?? 0}, reopened ${body?.evaluation?.reopenedInterventions ?? 0}, closed ${body?.evaluation?.closedInterventions ?? 0}. Queued notifications: ${body?.queueSummary?.queued ?? 0}.`
    );
    setIsEvaluating(false);
  }

  return (
    <div className="stack">
      <header>
        <h2>Policy Engine</h2>
        <p>Configure versioned discipline thresholds and run transition-based intervention evaluation.</p>
      </header>

      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}
      {message ? <p style={{ color: "#027a48" }}>{message}</p> : null}

      <section className="panel-muted">
        <div className="header-row">
          <h3>Current Policy</h3>
          <button type="button" onClick={() => void loadPolicies()} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {latest ? (
          <div>
            <p style={{ marginBottom: "0.25rem" }}>
              Version {latest.version} | Base X = {latest.baseThreshold}
            </p>
            <p style={{ marginBottom: "0.25rem" }}>Warnings: {latest.warningOffsets.join(", ")}</p>
            <p style={{ marginBottom: "0.25rem" }}>Milestones: {latest.milestones.join(", ")}</p>
            <p style={{ marginBottom: "0.25rem" }}>
              Created by {latest.createdBy} on {new Date(latest.createdAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p>No policy found yet.</p>
        )}
        <div className="button-row">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={queueNotifications}
              onChange={(event) => setQueueNotifications(event.currentTarget.checked)}
            />
            Queue notifications after evaluation
          </label>
          <button type="button" onClick={() => void onEvaluatePolicy()} disabled={isEvaluating || !latest}>
            {isEvaluating ? "Evaluating..." : "Evaluate Policy"}
          </button>
        </div>
      </section>

      <section>
        <h3>Create New Policy Version</h3>
        <form onSubmit={onCreatePolicy} className="form-wide">
          <label>
            Base Threshold X
            <input value={baseThreshold} onChange={(event) => setBaseThreshold(event.currentTarget.value)} />
          </label>
          <label>
            Warning Offsets (comma-separated)
            <input value={warningOffsets} onChange={(event) => setWarningOffsets(event.currentTarget.value)} />
          </label>
          <label>
            Milestones (comma-separated deltas)
            <input value={milestones} onChange={(event) => setMilestones(event.currentTarget.value)} />
          </label>
          <label>
            Intervention Templates JSON
            <textarea
              className="code-textarea"
              value={templatesJson}
              onChange={(event) => setTemplatesJson(event.currentTarget.value)}
              rows={12}
            />
          </label>
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Create Policy Version"}
          </button>
        </form>
      </section>

      <section>
        <h3>Policy History</h3>
        {policies.length === 0 ? (
          <p>No policy versions yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Base X</th>
                  <th>Warnings</th>
                  <th>Milestones</th>
                  <th>Created</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.version}>
                    <td>{policy.version}</td>
                    <td>{policy.baseThreshold}</td>
                    <td>{policy.warningOffsets.join(", ")}</td>
                    <td>{policy.milestones.join(", ")}</td>
                    <td>{new Date(policy.createdAt).toLocaleString()}</td>
                    <td>{policy.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
