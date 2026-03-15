"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Send, ShieldAlert, Users } from "lucide-react";

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  Select,
  SoftPanel,
  StatusBadge,
  Textarea,
  buttonStyles,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface NotificationConfig {
  sendStaffEmails: boolean;
  sendParentEmails: boolean;
  staffRecipients: string[];
  parentRecipients: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  maxAttempts: number;
  provider: "console" | "resend";
}

interface NotificationRow {
  id: string;
  studentId: string;
  interventionId: string;
  channel: "email" | "sms";
  recipient: string;
  status: "draft" | "approved" | "queued" | "sent" | "failed" | "suppressed";
  providerId: string;
  sentAt: string | null;
  error: string;
  kind?: string;
  draftSubject?: string | null;
}

interface ParentOutreachRow {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  totalPoints: number;
  bandLabel: string;
  recipient: string;
  guardianName: string | null;
  relationship: string | null;
  interventionId: string;
  latestIncidentAt: string | null;
  status: NotificationRow["status"];
  draftSubject: string;
  draftBody: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  suppressedReason: string | null;
  recipientSource: string;
}

interface GuardianContactRow {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  guardianName: string | null;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  allowEmail: boolean;
  sourceType: string;
  isActive: boolean;
}

const defaultConfig: NotificationConfig = {
  sendStaffEmails: false,
  sendParentEmails: false,
  staffRecipients: [],
  parentRecipients: [],
  subjectTemplate: "BHA discipline update for {{studentName}}",
  bodyTemplate:
    "Assalamu alaikum,\n\n{{studentName}} has reached {{points}} demerit points and is currently in the {{bandLabel}} discipline band. Please contact BHA administration if you have questions.\n\nRespectfully,\nBHA Administration",
  maxAttempts: 3,
  provider: "console"
};

function toneForNotificationStatus(status: NotificationRow["status"]): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "sent":
      return "success";
    case "approved":
      return "info";
    case "draft":
    case "queued":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function NotificationsClient() {
  const [config, setConfig] = useState<NotificationConfig>(defaultConfig);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [parentOutreachRows, setParentOutreachRows] = useState<ParentOutreachRow[]>([]);
  const [guardianContacts, setGuardianContacts] = useState<GuardianContactRow[]>([]);
  const [guardianSummary, setGuardianSummary] = useState({
    totalContacts: 0,
    emailEnabledContacts: 0,
    studentsCovered: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isOverrideQueueing, setIsOverrideQueueing] = useState(false);
  const [isImportingContacts, setIsImportingContacts] = useState(false);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [activeQueueActionId, setActiveQueueActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dispatchLimit, setDispatchLimit] = useState("50");
  const [guardianCsv, setGuardianCsv] = useState("");
  const [overrideStudentId, setOverrideStudentId] = useState("");
  const [overrideInterventionId, setOverrideInterventionId] = useState("");
  const [overrideRecipient, setOverrideRecipient] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubject, setOverrideSubject] = useState("");
  const [overrideBody, setOverrideBody] = useState("");

  const staffRecipientsText = useMemo(() => config.staffRecipients.join(", "), [config.staffRecipients]);
  const parentRecipientsText = useMemo(() => config.parentRecipients.join(", "), [config.parentRecipients]);
  const [staffRecipientsInput, setStaffRecipientsInput] = useState("");
  const [parentRecipientsInput, setParentRecipientsInput] = useState("");

  useEffect(() => {
    setStaffRecipientsInput(staffRecipientsText);
  }, [staffRecipientsText]);
  useEffect(() => {
    setParentRecipientsInput(parentRecipientsText);
  }, [parentRecipientsText]);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    const [configResponse, notificationsResponse, parentOutreachResponse, guardianContactsResponse] = await Promise.all([
      fetch("/api/notifications/config", { cache: "no-store" }),
      fetch("/api/notifications", { cache: "no-store" }),
      fetch("/api/notifications/parent-outreach", { cache: "no-store" }),
      fetch("/api/guardian-contacts", { cache: "no-store" })
    ]);

    const configBody = (await configResponse.json().catch(() => null)) as
      | { config?: NotificationConfig; error?: string }
      | null;
    const notificationsBody = (await notificationsResponse.json().catch(() => null)) as
      | { notifications?: NotificationRow[]; error?: string }
      | null;
    const parentOutreachBody = (await parentOutreachResponse.json().catch(() => null)) as
      | { rows?: ParentOutreachRow[]; error?: string }
      | null;
    const guardianContactsBody = (await guardianContactsResponse.json().catch(() => null)) as
      | {
          rows?: GuardianContactRow[];
          summary?: { totalContacts: number; emailEnabledContacts: number; studentsCovered: number };
          error?: string;
        }
      | null;

    if (!configResponse.ok) {
      setError(configBody?.error || "Failed to load notification config.");
      setIsLoading(false);
      return;
    }
    if (!notificationsResponse.ok) {
      setError(notificationsBody?.error || "Failed to load notifications.");
      setIsLoading(false);
      return;
    }
    if (!parentOutreachResponse.ok) {
      setError(parentOutreachBody?.error || "Failed to load parent outreach queue.");
      setIsLoading(false);
      return;
    }
    if (!guardianContactsResponse.ok) {
      setError(guardianContactsBody?.error || "Failed to load guardian contacts.");
      setIsLoading(false);
      return;
    }

    setConfig(configBody?.config ?? defaultConfig);
    setNotifications(notificationsBody?.notifications ?? []);
    setParentOutreachRows(parentOutreachBody?.rows ?? []);
    setGuardianContacts(guardianContactsBody?.rows ?? []);
    setGuardianSummary(
      guardianContactsBody?.summary ?? {
        totalContacts: 0,
        emailEnabledContacts: 0,
        studentsCovered: 0
      }
    );
    setIsLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function onSaveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload: NotificationConfig = {
      ...config,
      staffRecipients: staffRecipientsInput
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      parentRecipients: parentRecipientsInput
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    };

    const response = await fetch("/api/notifications/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to save notification config.");
      setIsSaving(false);
      return;
    }

    setMessage("Notification configuration saved.");
    setIsSaving(false);
    await loadData();
  }

  async function onDispatchQueue() {
    setIsDispatching(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: Number(dispatchLimit) || 50 })
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string; summary?: { attempted: number; sent: number; failed: number; deadLettered: number } }
      | null;
    if (!response.ok) {
      setError(body?.error || "Failed to dispatch notification queue.");
      setIsDispatching(false);
      return;
    }

    setMessage(
      `Dispatch complete. Attempted ${body?.summary?.attempted ?? 0}, sent ${body?.summary?.sent ?? 0}, failed ${body?.summary?.failed ?? 0}, dead-lettered ${body?.summary?.deadLettered ?? 0}.`
    );
    setIsDispatching(false);
    await loadData();
  }

  async function onQueueOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsOverrideQueueing(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/notifications/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: overrideStudentId,
        interventionId: overrideInterventionId,
        recipient: overrideRecipient,
        reason: overrideReason,
        subject: overrideSubject,
        body: overrideBody
      })
    });
    const body = (await response.json().catch(() => null)) as { error?: string; notification?: { id: string } } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to queue override notification.");
      setIsOverrideQueueing(false);
      return;
    }

    setMessage(`Override notification queued: ${body?.notification?.id ?? ""}`);
    setIsOverrideQueueing(false);
    await loadData();
  }

  async function onImportContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsImportingContacts(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/guardian-contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: guardianCsv })
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string; summary?: { rowsRead: number; contactsUpserted: number; warnings?: string[] } }
      | null;
    if (!response.ok) {
      setError(body?.error || "Failed to import guardian contacts.");
      setIsImportingContacts(false);
      return;
    }

    setMessage(
      `Imported guardian contacts. Rows read ${body?.summary?.rowsRead ?? 0}, contacts upserted ${body?.summary?.contactsUpserted ?? 0}.`
    );
    setGuardianCsv("");
    setIsImportingContacts(false);
    await loadData();
  }

  async function onSyncGuardianContacts() {
    setIsSyncingContacts(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/guardian-contacts/sycamore-sync", {
      method: "POST"
    });
    const body = (await response.json().catch(() => null)) as
      | {
          error?: string;
          summary?: { studentsFetched: number; studentsUpserted: number; contactsUpserted: number; warnings?: string[] };
        }
      | null;
    if (!response.ok) {
      setError(body?.error || "Failed to sync guardian contacts from Sycamore.");
      setIsSyncingContacts(false);
      return;
    }

    setMessage(
      `Sycamore contact sync complete. Students fetched ${body?.summary?.studentsFetched ?? 0}, contacts upserted ${body?.summary?.contactsUpserted ?? 0}.`
    );
    setIsSyncingContacts(false);
    await loadData();
  }

  async function onApproveParentOutreach(notificationId: string) {
    setActiveQueueActionId(notificationId);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/notifications/parent-outreach/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: [notificationId] })
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to approve parent outreach draft.");
      setActiveQueueActionId(null);
      return;
    }

    setMessage("Parent outreach draft approved.");
    setActiveQueueActionId(null);
    await loadData();
  }

  async function onSuppressParentOutreach(notificationId: string) {
    setActiveQueueActionId(notificationId);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/notifications/parent-outreach/suppress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationIds: [notificationId],
        reason: "Suppressed from notification queue."
      })
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to suppress parent outreach draft.");
      setActiveQueueActionId(null);
      return;
    }

    setMessage("Parent outreach draft suppressed.");
    setActiveQueueActionId(null);
    await loadData();
  }

  const queuedCount = notifications.filter((notification) => notification.status === "queued").length;
  const sentCount = notifications.filter((notification) => notification.status === "sent").length;
  const failedCount = notifications.filter((notification) => notification.status === "failed").length;
  const parentDraftCount = parentOutreachRows.filter((row) => row.status === "draft").length;
  const parentApprovedCount = parentOutreachRows.filter((row) => row.status === "approved").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Notification operations"
        description="Triages parent outreach first, then lets you drop into the student case file for deeper review before sending."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadData()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Notification operation failed.">
          {error}
        </InlineAlert>
      ) : null}
      {message ? (
        <InlineAlert tone="success" title="Notification state updated.">
          {message}
        </InlineAlert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="font-display text-2xl text-[var(--color-ink)]">Parent outreach queue</h2>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Review the draft queue here, then open the case file when a student needs deeper context before approval.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="warning">{parentDraftCount} drafts</StatusBadge>
              <StatusBadge tone="info">{parentApprovedCount} approved</StatusBadge>
              <StatusBadge tone="success">{guardianSummary.studentsCovered} students covered</StatusBadge>
            </div>
          </div>

          {parentOutreachRows.length === 0 ? (
            <EmptyState
              title="No parent outreach drafts"
              description="Once policy evaluation creates 10-19 threshold interventions, parent drafts will appear here for approval."
            />
          ) : (
            <div className={tableShellClassName}>
              <div className="overflow-x-auto">
                <table className={tableClassName}>
                  <thead>
                    <tr>
                      <th className={tableHeadCellClassName}>Student</th>
                      <th className={tableHeadCellClassName}>Band</th>
                      <th className={tableHeadCellClassName}>Recipient</th>
                      <th className={tableHeadCellClassName}>Draft</th>
                      <th className={tableHeadCellClassName}>Status</th>
                      <th className={tableHeadCellClassName}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {parentOutreachRows.map((row) => (
                      <tr key={row.id}>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">{row.studentName}</p>
                            <p className="text-sm text-[var(--color-muted)]">
                              Grade {row.grade} • {row.totalPoints} pts
                              {row.latestIncidentAt ? ` • ${new Date(row.latestIncidentAt).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>{row.bandLabel}</td>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">{row.recipient}</p>
                            <p className="text-sm text-[var(--color-muted)]">
                              {row.guardianName || row.relationship || row.recipientSource}
                            </p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">{row.draftSubject}</p>
                            <p className="line-clamp-3 text-sm text-[var(--color-muted)] whitespace-pre-wrap">
                              {row.draftBody}
                            </p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          <div className="space-y-2">
                            <StatusBadge tone={toneForNotificationStatus(row.status)}>{row.status}</StatusBadge>
                            {row.approvedAt ? (
                              <p className="text-xs text-[var(--color-muted)]">
                                Approved {new Date(row.approvedAt).toLocaleDateString()}
                              </p>
                            ) : null}
                            {row.suppressedReason ? (
                              <p className="text-xs text-[var(--color-muted)]">{row.suppressedReason}</p>
                            ) : null}
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          <div className="flex flex-col gap-2">
                            <Link
                              href={`/students?mode=case_file&studentId=${encodeURIComponent(row.studentId)}&detailTab=notifications`}
                              className={cn(buttonStyles({ variant: "secondary", size: "sm" }), "justify-center")}
                            >
                              Open case file
                            </Link>
                            {row.status !== "approved" && row.status !== "sent" && row.status !== "suppressed" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                disabled={activeQueueActionId === row.id}
                                onClick={() => void onApproveParentOutreach(row.id)}
                              >
                                Approve
                              </Button>
                            ) : null}
                            {row.status !== "sent" && row.status !== "suppressed" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={activeQueueActionId === row.id}
                                onClick={() => void onSuppressParentOutreach(row.id)}
                              >
                                Suppress
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-[#edf7f6] p-3 text-[var(--color-primary)]">
                <Users className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Guardian contacts</h2>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Keep parent coverage healthy so 10-19 outreach can move without manual cleanup.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <SoftPanel className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Contacts</p>
                <p className="font-display text-3xl text-[var(--color-ink)]">{guardianSummary.totalContacts}</p>
              </SoftPanel>
              <SoftPanel className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Email enabled</p>
                <p className="font-display text-3xl text-[var(--color-ink)]">{guardianSummary.emailEnabledContacts}</p>
              </SoftPanel>
              <SoftPanel className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Students covered</p>
                <p className="font-display text-3xl text-[var(--color-ink)]">{guardianSummary.studentsCovered}</p>
              </SoftPanel>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" disabled={isSyncingContacts} onClick={() => void onSyncGuardianContacts()}>
                {isSyncingContacts ? "Syncing..." : "Sync from Sycamore"}
              </Button>
            </div>

            <form onSubmit={onImportContacts} className="space-y-4">
              <Field
                label="CSV import"
                hint="Headers: student_id,external_id,student_name,guardian_name,relationship,email,phone,is_primary,notes"
              >
                <Textarea rows={8} value={guardianCsv} onChange={(event) => setGuardianCsv(event.currentTarget.value)} />
              </Field>
              <Button type="submit" variant="primary" disabled={isImportingContacts}>
                {isImportingContacts ? "Importing..." : "Import contacts"}
              </Button>
            </form>

            {guardianContacts.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[var(--color-ink)]">Recent contact coverage</p>
                <div className="grid gap-3">
                  {guardianContacts.slice(0, 6).map((contact) => (
                    <div
                      key={contact.id}
                      className="rounded-[1.2rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-[var(--color-ink)]">
                          {contact.studentName} • {contact.guardianName || contact.relationship || "Guardian"}
                        </p>
                        <StatusBadge tone={contact.email && contact.allowEmail && contact.isActive ? "success" : "warning"}>
                          {contact.email && contact.allowEmail && contact.isActive ? "Ready" : "Needs review"}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-muted)]">
                        {contact.email || "No email on file"}
                        {contact.sourceType ? ` • ${contact.sourceType}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-display text-2xl text-[var(--color-ink)]">Configuration</h2>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="warning">{queuedCount} queued</StatusBadge>
              <StatusBadge tone="success">{sentCount} sent</StatusBadge>
              <StatusBadge tone={failedCount > 0 ? "danger" : "neutral"}>{failedCount} failed</StatusBadge>
            </div>
          </div>

          <form onSubmit={onSaveConfig} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                <label className="flex items-center gap-3 text-sm text-[var(--color-ink)]">
                  <Checkbox
                    checked={config.sendStaffEmails}
                    onChange={(event) =>
                      setConfig((prev) => ({ ...prev, sendStaffEmails: event.currentTarget.checked }))
                    }
                  />
                  Send staff emails
                </label>
              </div>
              <div className="rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                <label className="flex items-center gap-3 text-sm text-[var(--color-ink)]">
                  <Checkbox
                    checked={config.sendParentEmails}
                    onChange={(event) =>
                      setConfig((prev) => ({ ...prev, sendParentEmails: event.currentTarget.checked }))
                    }
                  />
                  Generate parent outreach drafts
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Staff recipients" hint="Comma-separated operational recipients">
                <Input value={staffRecipientsInput} onChange={(event) => setStaffRecipientsInput(event.currentTarget.value)} />
              </Field>
              <Field label="Fallback parent recipients" hint="Used only when no guardian contact exists">
                <Input value={parentRecipientsInput} onChange={(event) => setParentRecipientsInput(event.currentTarget.value)} />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <Field label="Subject template">
                <Input
                  value={config.subjectTemplate}
                  onChange={(event) => setConfig((prev) => ({ ...prev, subjectTemplate: event.currentTarget.value }))}
                />
              </Field>
              <Field label="Provider">
                <Select
                  value={config.provider}
                  onChange={(event) => setConfig((prev) => ({ ...prev, provider: event.currentTarget.value as "console" | "resend" }))}
                >
                  <option value="console">Console</option>
                  <option value="resend">Resend</option>
                </Select>
              </Field>
            </div>

            <Field label="Body template">
              <Textarea
                rows={8}
                value={config.bodyTemplate}
                onChange={(event) => setConfig((prev) => ({ ...prev, bodyTemplate: event.currentTarget.value }))}
              />
            </Field>

            <Field label="Max attempts">
              <Input
                value={String(config.maxAttempts)}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, maxAttempts: Number(event.currentTarget.value) || 3 }))
                }
              />
            </Field>

            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save configuration"}
            </Button>
          </form>
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-5">
            <div className="space-y-2">
              <h2 className="font-display text-2xl text-[var(--color-ink)]">Dispatch</h2>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Dispatch approved parent outreach and any queued operational emails.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <Field label="Dispatch limit">
                <Input value={dispatchLimit} onChange={(event) => setDispatchLimit(event.currentTarget.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="primary" className="w-full md:w-auto" onClick={() => void onDispatchQueue()} disabled={isDispatching}>
                  <Send className="h-4 w-4" />
                  {isDispatching ? "Dispatching..." : "Dispatch"}
                </Button>
              </div>
            </div>
            <SoftPanel className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[var(--color-ink)]">Provider</p>
                <StatusBadge tone="neutral">{config.provider}</StatusBadge>
              </div>
              {config.provider === "resend" ? (
                <p className="text-sm text-[var(--color-muted)]">
                  Ensure `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` are configured in the environment before dispatching.
                </p>
              ) : null}
            </SoftPanel>
          </Panel>

          <Panel className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-[#fff0ea] p-3 text-[var(--color-danger)]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Queue override</h2>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Use only for exceptions that should bypass the normal threshold draft flow.
                </p>
              </div>
            </div>

            <form onSubmit={onQueueOverride} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Student ID">
                  <Input value={overrideStudentId} onChange={(event) => setOverrideStudentId(event.currentTarget.value)} />
                </Field>
                <Field label="Intervention ID">
                  <Input
                    value={overrideInterventionId}
                    onChange={(event) => setOverrideInterventionId(event.currentTarget.value)}
                  />
                </Field>
                <Field label="Recipient email">
                  <Input value={overrideRecipient} onChange={(event) => setOverrideRecipient(event.currentTarget.value)} />
                </Field>
                <Field label="Override reason">
                  <Input value={overrideReason} onChange={(event) => setOverrideReason(event.currentTarget.value)} />
                </Field>
                <Field label="Subject" className="md:col-span-2">
                  <Input value={overrideSubject} onChange={(event) => setOverrideSubject(event.currentTarget.value)} />
                </Field>
                <Field label="Body" className="md:col-span-2">
                  <Textarea rows={5} value={overrideBody} onChange={(event) => setOverrideBody(event.currentTarget.value)} />
                </Field>
              </div>
              <Button type="submit" variant="secondary" disabled={isOverrideQueueing}>
                {isOverrideQueueing ? "Queueing..." : "Queue override notification"}
              </Button>
            </form>
          </Panel>
        </div>
      </section>

      <Panel className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-[var(--color-ink)]">Recent notifications</h2>
          <StatusBadge tone="neutral">{notifications.length} rows</StatusBadge>
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            description="Notifications will appear here once policy runs begin queueing messages."
          />
        ) : (
          <div className={tableShellClassName}>
            <div className="overflow-x-auto">
              <table className={tableClassName}>
                <thead>
                  <tr>
                    <th className={tableHeadCellClassName}>ID</th>
                    <th className={tableHeadCellClassName}>Kind</th>
                    <th className={tableHeadCellClassName}>Status</th>
                    <th className={tableHeadCellClassName}>Recipient</th>
                    <th className={tableHeadCellClassName}>Student</th>
                    <th className={tableHeadCellClassName}>Sent at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {notifications.map((notification) => (
                    <tr key={notification.id}>
                      <td className={tableCellClassName}>{notification.id}</td>
                      <td className={tableCellClassName}>{notification.kind ?? "policy"}</td>
                      <td className={tableCellClassName}>
                        <StatusBadge tone={toneForNotificationStatus(notification.status)}>{notification.status}</StatusBadge>
                      </td>
                      <td className={tableCellClassName}>{notification.recipient}</td>
                      <td className={tableCellClassName}>{notification.studentId}</td>
                      <td className={tableCellClassName}>
                        {notification.sentAt ? new Date(notification.sentAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
