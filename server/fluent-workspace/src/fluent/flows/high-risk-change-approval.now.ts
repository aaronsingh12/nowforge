// nowforge-spec: 8adebe3048062d0c
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
  {
    $id: Now.ID['high_risk_change_approval_flow_main'],
    name: 'High Risk Change Approval',
    description: 'When a change request is created with High risk, ask the Network group manager to approve and add a work note on approval.',
    runAs: 'system',
  },
  wfa.trigger(
    trigger.record.created,
    { $id: Now.ID['high_risk_change_approval_trigger'] },
    {
      table: 'change_request',
      condition: 'risk=2',
      run_flow_in: 'background',
    }
  ),
  (params) => {
    const networkGroup = wfa.action(
      action.core.lookUpRecord,
      { $id: Now.ID['high_risk_change_approval_lookup_network'] },
      {
        table: 'sys_user_group',
        conditions: `sys_id=287ebd7da9fe198100f92cc8d1d2154e`,
      }
    );

    const approval = wfa.action(
      action.core.askForApproval,
      { $id: Now.ID['high_risk_change_approval_ask'] },
      {
        record: wfa.dataPill(params.trigger.current, 'reference'),
        table: 'change_request',
        approval_reason: 'High Risk Change Approval',
        approval_conditions: wfa.approvalRules({
          conditionType: 'OR',
          ruleSets: [
            {
              action: 'ApprovesRejects',
              conditionType: 'AND',
              rules: [
                [
                  {
                    ruleType: 'Any',
                    users: [wfa.dataPill(networkGroup.Record.manager, 'reference')],
                    groups: [],
                    manual: false,
                  },
                ],
              ],
            },
          ],
        }),
      }
    );

    wfa.flowLogic.if(
      {
        $id: Now.ID['high_risk_change_approval_if_approved'],
        condition: `${wfa.dataPill(approval.approval_state, 'choice')}=approved`,
      },
      () => {
        wfa.action(
          action.core.updateRecord,
          { $id: Now.ID['high_risk_change_approval_update_note'] },
          {
            table_name: 'change_request',
            record: wfa.dataPill(params.trigger.current, 'reference'),
            values: TemplateValue({
              work_notes: 'NowForge: change approved by the Network manager',
            }),
          }
        );
      }
    );
  }
);