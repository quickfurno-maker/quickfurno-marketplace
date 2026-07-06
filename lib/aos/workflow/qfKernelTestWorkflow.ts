import type { WorkflowDefinition } from "./workflowTypes";

export const QF_KERNEL_TEST_WORKFLOW_TYPE = "qf_kernel_test";

export function createQfKernelTestWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowType: QF_KERNEL_TEST_WORKFLOW_TYPE,
    initialState: "CREATED",
    activeStatus: "active",
    terminalStates: ["COMPLETED", "FAILED"],
    transitions: {
      CREATED: ["READY"],
      READY: ["PROCESSING"],
      PROCESSING: ["COMPLETED", "FAILED"],
    },
    handler: ({ workflow, event }) => {
      const path = typeof event.payload_json.path === "string" ? event.payload_json.path : "task";

      if (workflow.current_state === "CREATED") {
        return {
          nextState: "READY",
          workflowStatus: "active",
          reason: "Kernel test workflow initialized.",
          metadata: { path },
          tasks: [
            {
              taskType: "qf_kernel_test.process",
              payload: { event_id: event.id, path },
              idempotencyKey: `qf_kernel_test:task:${event.id}:process`,
              priority: 100,
              maxAttempts: 5,
            },
          ],
        };
      }

      if (workflow.current_state === "READY") {
        return {
          nextState: "PROCESSING",
          workflowStatus: "active",
          reason: "Kernel test workflow moved to processing.",
          metadata: { path },
        };
      }

      if (workflow.current_state === "PROCESSING" && path === "fail") {
        return {
          nextState: "FAILED",
          workflowStatus: "failed",
          reason: "Kernel test workflow deterministic failure branch.",
          metadata: { path },
        };
      }

      return {
        nextState: "COMPLETED",
        workflowStatus: "completed",
        reason: "Kernel test workflow deterministic completion branch.",
        metadata: { path },
        outboxCommands: path === "outbox"
          ? [
              {
                commandType: "test.noop",
                entityType: "workflow",
                entityId: workflow.id,
                payload: { event_id: event.id, workflow_type: QF_KERNEL_TEST_WORKFLOW_TYPE },
                idempotencyKey: `qf_kernel_test:outbox:${event.id}:noop`,
              },
            ]
          : [],
      };
    },
  };
}

