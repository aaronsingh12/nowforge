import { Subflow, wfa, action } from '@servicenow/sdk/automation'
import { StringColumn, BooleanColumn } from '@servicenow/sdk/core'

/**
 * UC2 - "Notify Manager"
 *
 * Reusable subflow: given any task-extended record, email the manager of that
 * record's assignment group. Invoked by UC1 (P1 Network Escalation).
 *
 * Inputs are the table + sys_id rather than a typed reference so the subflow
 * works against any task-extended table (incident, sc_task, change_task...).
 */
export const notifyManager = Subflow(
    {
        $id: Now.ID['notify_manager_subflow'],
        name: 'Notify Manager',
        description: "Emails the manager of a task record's assignment group.",
        runAs: 'system',
        inputs: {
            taskTable: StringColumn({ label: 'Task Table', mandatory: true }),
            taskSysId: StringColumn({ label: 'Task Sys ID', mandatory: true }),
            message: StringColumn({ label: 'Message', mandatory: true }),
        },
        outputs: {
            notified: BooleanColumn({ label: 'Notified' }),
            managerEmail: StringColumn({ label: 'Manager Email' }),
        },
    },
    (params) => {
        const task = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['nm_lookup_task'], annotation: 'Load the task record' },
            {
                table: wfa.dataPill(params.inputs.taskTable, 'string'),
                conditions: `sys_id=${wfa.dataPill(params.inputs.taskSysId, 'string')}`,
            }
        )

        wfa.flowLogic.if(
            {
                $id: Now.ID['nm_has_manager_email'],
                label: 'Manager has an email address',
                condition: `${wfa.dataPill(task.Record.assignment_group.manager.email, 'string')}ISNOTEMPTY`,
            },
            () => {
                // ah_subject supports data pills via template literals; ah_body does NOT.
                wfa.action(
                    action.core.sendEmail,
                    { $id: Now.ID['nm_send_email'], annotation: 'Email the group manager' },
                    {
                        ah_to: `${wfa.dataPill(task.Record.assignment_group.manager.email, 'string')}`,
                        ah_subject: `${wfa.dataPill(params.inputs.message, 'string')} - ${wfa.dataPill(task.Record.number, 'string')}`,
                        ah_body: 'A record assigned to your group requires your attention. Open the linked record in ServiceNow for full details.',
                        record: wfa.dataPill(task.Record, 'reference'),
                        table_name: wfa.dataPill(params.inputs.taskTable, 'string'),
                    }
                )

                wfa.flowLogic.assignSubflowOutputs(
                    { $id: Now.ID['nm_outputs_sent'] },
                    params.outputs,
                    {
                        notified: true,
                        managerEmail: wfa.dataPill(task.Record.assignment_group.manager.email, 'string'),
                    }
                )
            }
        )

        wfa.flowLogic.else({ $id: Now.ID['nm_no_manager'] }, () => {
            wfa.action(
                action.core.log,
                { $id: Now.ID['nm_log_no_manager'] },
                {
                    log_level: 'warn',
                    log_message: 'Notify Manager: no manager email on the assignment group.',
                }
            )

            wfa.flowLogic.assignSubflowOutputs(
                { $id: Now.ID['nm_outputs_skipped'] },
                params.outputs,
                { notified: false, managerEmail: '' }
            )
        })
    }
)
