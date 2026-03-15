"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Send, ShieldAlert } from "lucide-react";

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  SoftPanel,
  StatusBadge,
  Textarea,
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
  provider: "console";
}

interface NotificationRow {
  id: string;
  studentId: string;
  interventionId: string;
  channel: "email" | "sms";
  recipient: string;
  status: "queued" | "sent" | "failed";
  providerId: string;
  sentAt: string | null;
  error: string;
}

const defaultConfig: NotificationConfig = {
  sendStaffEmails: false,
  sendParentEmails: false,
  staffRecipients: [],
  parentRecipients: [],
  subjectTemplate: "",
  bodyTemplate: "",
  maxAttempts: 3,
  provider: "console"
};

function toneForNotificationStatus(status: NotificationRow["status"]): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "sent":
      return "success";
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
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isOverrideQueueing, setIsOverrideQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dispatchLimit, setDispatchLimit] = useState("50");
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

    const [configResponse, notificationsResponse] = await Promise.all([
      fetch("/api/notifications/config", { cache: "no-store" }),
      fetch("/api/notifications", { cache: "no-store" })
    ]);

    const configBody = (await configResponse.json().catch(() => null)) as
      | { config?: NotificationConfig; error?: string }
      | null;
    const notificationsBody = (await notificationsResponse.json().catch(() => null)) as
      | { notifications?: NotificationRow[]; error?: string }
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

    setConfig(configBody?.config ?? defaultConfig);
    setNotifications(notificationsBody?.notifications ?? []);
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

    setMessage("Notification config saved.");
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

  const queuedCount = notifications.filter((notification) => notification.status === "queued").length;
  const sentCount = notifications.filter((notification) => notification.status === "sent").length;
  const failedCount = notifications.filter((notification) => notification.status === "failed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Operate the notification pipeline"
        description="Manage recipients, templates, dispatch cadence, and manual overrides from a single message operations surface."
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
                  Send parent emails
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Staff recipients" hint="Comma-separated email list">
                <Input value={staffRecipientsInput} onChange={(event) => setStaffRecipientsInput(event.currentTarget.value)} />
              </Field>
              <Field label="Parent recipients" hint="Comma-separated email list">
                <Input value={parentRecipientsInput} onChange={(event) => setParentRecipientsInput(event.currentTarget.value)} />
              </Field>
            </div>

            <Field label="Subject template">
              <Input
                value={config.subjectTemplate}
                onChange={(event) => setConfig((prev) => ({ ...prev, subjectTemplate: event.currentTarget.value }))}
              />
            </Field>

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
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <Field label="Dispatch limit">
                <Input value={dispatchLimit} onChange={(event) => setDispatchLimit(event.currentTarget.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="primary" className="w-full md:w-auto" onClick={() => void onDispatchQueue()} disabled={isDispatching}>
                  <Send className="h-4 w-4" />
                  {isDispatching ? "Dispatching..." : "Dispatch queue"}
                </Button>
              </div>
            </div>
            <SoftPanel className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[var(--color-ink)]">Provider</p>
                <StatusBadge tone="neutral">{config.provider}</StatusBadge>
              </div>
            </SoftPanel>
          </Panel>

          <Panel className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-[#fff0ea] p-3 text-[var(--color-danger)]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Queue override</h2>
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
                    <th className={tableHeadCellClassName}>Status</th>
                    <th className={tableHeadCellClassName}>Recipient</th>
                    <th className={tableHeadCellClassName}>Student</th>
                    <th className={tableHeadCellClassName}>Intervention</th>
                    <th className={tableHeadCellClassName}>Sent at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {notifications.map((notification) => (
                    <tr key={notification.id}>
                      <td className={tableCellClassName}>{notification.id}</td>
                      <td className={tableCellClassName}>
                        <StatusBadge tone={toneForNotificationStatus(notification.status)}>{notification.status}</StatusBadge>
                      </td>
                      <td className={tableCellClassName}>{notification.recipient}</td>
                      <td className={tableCellClassName}>{notification.studentId}</td>
                      <td className={tableCellClassName}>{notification.interventionId}</td>
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
