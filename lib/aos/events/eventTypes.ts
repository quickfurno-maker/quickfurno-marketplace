export const aosEventTypes = {
  agentTaskQueued: "agent.task.queued",
  agentTaskCompleted: "agent.task.completed",
  approvalRequested: "approval.requested",
  auditLogged: "audit.logged",
} as const;

export type AOSEventType = (typeof aosEventTypes)[keyof typeof aosEventTypes];

