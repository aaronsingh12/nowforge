import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    add_non_critical_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e5fe8f73bf97433b928b10187334ccf3'
                    }
                    add_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '10c0ec9dcf0c486ab1e40f73c0edbe8d'
                        deleted: false
                    }
                    assign_if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'bb65831c5b4848e68af515523b007356'
                    }
                    assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ad05f662c13249358c088403169edd1c'
                        deleted: true
                    }
                    auto_triage_incident_flow: {
                        table: 'sys_hub_flow'
                        id: '749b892b8b4444048c0711c1b519c8ba'
                        deleted: true
                    }
                    auto_triage_incident_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'b43a85896a4c4ff583395e7345731051'
                        deleted: true
                    }
                    auto_triage_log: {
                        table: 'sys_hub_action_instance_v2'
                        id: '200ab7ad805f49c1958f129d94f119e8'
                        deleted: true
                    }
                    auto_triage_update: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cab695f1675a41a0b54d7f238621dab6'
                        deleted: true
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '39e89ebd1f99428e9dab343b4b3f0248'
                    }
                    call_notify_manager: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: '022121081c3f41808cdd6805658b2298'
                        deleted: false
                    }
                    cphv_create_problem: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cdb31f0bfe1f4806afc9fc244b6f9bc4'
                    }
                    cphv_flow: {
                        table: 'sys_hub_flow'
                        id: 'c8ababc31afa49929182a12b4bdbe0ee'
                    }
                    cphv_hw_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a8bab536467847c4b5e1988cf5874216'
                    }
                    cphv_if_critical: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'e967df809629415d97ab4b57114cc323'
                    }
                    cphv_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '5667217123574665ab56f376cb32025a'
                    }
                    cphv_update_incident_problem: {
                        table: 'sys_hub_action_instance_v2'
                        id: '23f6b785829c4848ba07a4cc85e72d66'
                    }
                    cphv_update_incident_worknote: {
                        table: 'sys_hub_action_instance_v2'
                        id: '64e10d01c8c848baa786d3145ab2d8bc'
                    }
                    cphv_update_problem_assigned: {
                        table: 'sys_hub_action_instance_v2'
                        id: '09deaba3814c475a983d37a050ad85ea'
                    }
                    daily_p1_digest_flow: {
                        table: 'sys_hub_flow'
                        id: 'b2f18c963fd244f6a02895a7a6359536'
                        deleted: false
                    }
                    demo_incident_created_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '0fe23bcad3a64045bafebc46f7472bb8'
                    }
                    demo_incident_flow_main: {
                        table: 'sys_hub_flow'
                        id: 'ba6a8fa5c6674115bb3b405498bad6c4'
                    }
                    demo_incident_priority_notification_flow: {
                        table: 'sys_hub_flow'
                        id: 'a61c24ed9dde42c09544c621983fca00'
                    }
                    demo_incident_priority_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'c0c731a08daa44bb91c887e4c99bfb30'
                    }
                    dpd_any_found: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '0cb679e794b2426190e6e12134d295c5'
                        deleted: false
                    }
                    dpd_each: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '440ea76341dc427393923d9fbf62ea5c'
                        deleted: false
                    }
                    dpd_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '69243c878a7c4623ab70a0ba1011d58a'
                        deleted: false
                    }
                    dpd_log_each: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c91600547a1040f4884355698b172d27'
                        deleted: false
                    }
                    dpd_log_none: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e77eed075dbe40c98848afad5ce15f87'
                        deleted: false
                    }
                    dpd_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e20f71c8d6804fb89b64b3553610ad58'
                        deleted: false
                    }
                    dpd_none: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'f78977d00e334a91a17951ce4c8b597e'
                        deleted: false
                    }
                    dpd_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'f08c35b8fb92486194178b5f8be6caab'
                        deleted: false
                    }
                    else_non_critical: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'e8af78ee1b18483b8146ecec232c8d55'
                    }
                    email_to_incident_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '683885121fec49d39198132759a335ae'
                    }
                    escalate_high_priority_problem: {
                        table: 'sys_hub_flow'
                        id: '7b3b6c461a9a47d3be625bc2b168ccb4'
                        deleted: true
                    }
                    escalate_network_p1_incident_flow: {
                        table: 'sys_hub_flow'
                        id: '55a03b37873b431688ca3e7e0c06ba68'
                    }
                    escalate_network_p1_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '1e31e27417044b42b3b8b3fde74f4fd0'
                    }
                    escalate_p1_add_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '9dd8b031333e41dfb60a917825f45c1d'
                        deleted: true
                    }
                    escalate_p1_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '947066cb406349e0830317a4fdb31a1c'
                        deleted: true
                    }
                    escalate_p1_call_notify_manager: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: '1660267816fe4b71adf52d1984a19800'
                        deleted: true
                    }
                    escalate_p1_created_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '3318638771144816960b7fa26bc9447f'
                        deleted: true
                    }
                    escalate_p1_has_manager_email: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'bf05c0dc8d304064bd9a9730858f3552'
                        deleted: true
                    }
                    escalate_p1_if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '0af65c99a70149d688f57b7d64da097a'
                        deleted: true
                    }
                    escalate_p1_log_no_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '7b976dd843924517bf30708dbdb9b5ed'
                        deleted: true
                    }
                    escalate_p1_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '129babfe33ab4979bffabf265cc0a4bd'
                        deleted: true
                    }
                    escalate_p1_lookup_task: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd511f735903048be8c010511b9bc67da'
                        deleted: true
                    }
                    escalate_p1_network_incident_flow: {
                        table: 'sys_hub_flow'
                        id: '64e19714fd334fc8bcda84c7341d68d1'
                        deleted: true
                    }
                    escalate_p1_network_incidents_flow: {
                        table: 'sys_hub_flow'
                        id: '43911479f06844968099f9510a915160'
                        deleted: true
                    }
                    escalate_p1_no_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '4ef63704022b4753920b38df17128c03'
                        deleted: true
                    }
                    escalate_p1_notify_manager_subflow: {
                        table: 'sys_hub_flow'
                        id: '5f71545a40184eda9b64654f7da65aa7'
                        deleted: true
                    }
                    escalate_p1_outputs_sent: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '38815e08bede4526bcbf01db0cc7844a'
                        deleted: true
                    }
                    escalate_p1_outputs_skipped: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '271d2b979aa84f4b8521fca37d582e3e'
                        deleted: true
                    }
                    escalate_p1_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '0c379ef11dd346fc819c9f9eadf5e9d9'
                        deleted: true
                    }
                    flag_high_risk_change_flow: {
                        table: 'sys_hub_flow'
                        id: 'bb2a09da78684982b31daf9a0edf3cff'
                        deleted: true
                    }
                    flag_high_risk_change_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '8cb9aee2efe343bea65269d4fab78bfb'
                        deleted: true
                    }
                    flag_high_risk_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '63969ce6be924657b40ec4ea81df9652'
                        deleted: true
                    }
                    handle_high_priority_incident: {
                        table: 'sys_hub_flow'
                        id: '1dea409991ee44a3ba375ac6ebbdeb4d'
                    }
                    handle_high_priority_incident_flow: {
                        table: 'sys_hub_flow'
                        id: '15c78bbff94945879529d7b3ae065403'
                        deleted: true
                    }
                    hhpi_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '74ba61aa76c94188ae4f0979b354eb5e'
                        deleted: true
                    }
                    hhpi_if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '6828d9e241ff4b20ab56270e9b0dcb83'
                        deleted: true
                    }
                    hhpi_log: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'b402da1b54a54c2da2e6f379f3909cd5'
                        deleted: true
                    }
                    hhpi_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '35cd491174d44065a044bc86edd94d21'
                        deleted: true
                    }
                    hhpi_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '91aca5fc1f5d448d9319553ef8754830'
                        deleted: true
                    }
                    hhpi_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'f36f3e3e355a4c08b51e0324dd461d90'
                        deleted: true
                    }
                    hhpi_update_work_notes: {
                        table: 'sys_hub_action_instance_v2'
                        id: '5355a1e3e2194efbbb45db9ffaebc955'
                        deleted: true
                    }
                    high_risk_change_approval_ask: {
                        table: 'sys_hub_action_instance_v2'
                        id: '7a2a72661556428c8ac096f3e93bfc83'
                        deleted: true
                    }
                    high_risk_change_approval_flow_main: {
                        table: 'sys_hub_flow'
                        id: 'ccfaa494903b47ba9b494675c466a681'
                        deleted: true
                    }
                    high_risk_change_approval_if_approved: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '58b763ae55e34382903fcc5007bcfbf2'
                        deleted: true
                    }
                    high_risk_change_approval_lookup_network: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a6d6da08d3fd47a7a6907471c8255724'
                        deleted: true
                    }
                    high_risk_change_approval_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'c2eeb5012b01434ea1c92c36d4e24723'
                        deleted: true
                    }
                    high_risk_change_approval_update_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '85a7c398dfc34ec68575e54754c2328f'
                        deleted: true
                    }
                    hp_add_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c194dc95dbfa415f800afa580bede0ab'
                        deleted: true
                    }
                    hp_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '25101a2cb92b4fc2a153108aa56eaa66'
                        deleted: true
                    }
                    hp_if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '0d1279e16a7549cabadaa6012251e531'
                        deleted: true
                    }
                    hp_inc_created: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'b71bf136d0664ee0ab4aa54bae868c96'
                        deleted: true
                    }
                    hp_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '21eb3fecbe674526945afe0380487cef'
                        deleted: true
                    }
                    hp_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '546f7add4e1e4514bd72030eb131a95a'
                        deleted: true
                    }
                    hpi_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '040255d5ed284d1591115ee6903c5275'
                    }
                    hpi_if_high_priority: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'e6f14d1c37b24156ae4c1e54df859cc5'
                    }
                    hpi_if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'e4b440e2c90e4aa4a228c05a9534687e'
                    }
                    hpi_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '2d74dff9ea7040f19359d55c57362a56'
                    }
                    hpi_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '3a1e89d553734258869f96fcf6e2c4fd'
                    }
                    hpi_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '605ce77aea4f4fc5a7e06117920dad23'
                    }
                    hpi_update_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '8a12e793640f4896bf5c917ff0f00c2a'
                    }
                    hrc_ask_approval: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c3f8204bbaec45a6a142e29cfd35df4c'
                    }
                    hrc_flow: {
                        table: 'sys_hub_flow'
                        id: 'f251ba67ed9649af82866f955697260e'
                    }
                    hrc_if_approved: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '01a1f25226b54ea88b7a393ee0a3f3a1'
                    }
                    hrc_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '19d5beba58c54c7f87f40c3ec43e6b1a'
                    }
                    hrc_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '01fd948359bb4a08b921608bb2a1dc2d'
                    }
                    hrc_update_worknote: {
                        table: 'sys_hub_action_instance_v2'
                        id: '1a9dfa4ff6254075906effaf6a7df5d2'
                    }
                    if_priority_critical: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '3f6799c741524cc3afadf8bbd2a3e52d'
                    }
                    if_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '2adf0780a1654dbfb4c7ab9d55eec34a'
                        deleted: true
                    }
                    log: {
                        table: 'sys_hub_action_instance_v2'
                        id: '7161dff12b824dc4bd962ff85a46711e'
                        deleted: true
                    }
                    log_change_number: {
                        table: 'sys_hub_action_instance_v2'
                        id: '382415adc84a4365bcd57a5259be5f3f'
                        deleted: true
                    }
                    lookup_incident_manager_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '2825f82d5d35416fa3221c3101eed8de'
                    }
                    lookup_network_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '92cb08f2551d4ae0b3d52873ccbf1e5d'
                        deleted: false
                    }
                    nm_has_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '834bd04cf6684bc6b7109848c7d58257'
                        deleted: true
                    }
                    nm_has_manager_email: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '9fefd0dca0a2419ba26d1f90a310f6bd'
                        deleted: false
                    }
                    nm_log_no_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '8e05308fe5084b28aebba5ae0c366391'
                        deleted: true
                    }
                    nm_lookup_task: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ad24da89756847f6a00acf83fd95fad0'
                        deleted: false
                    }
                    nm_no_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '61894ef0d1b645a5941187cf8f63ea54'
                    }
                    nm_output_failure: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'ff4a9fe87a6f432692f479147ec214fe'
                        deleted: true
                    }
                    nm_output_success: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'ae77f2c9f6e24981a4e1446737f86bd0'
                        deleted: true
                    }
                    nm_outputs_no_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '4e778592f15243ce8673f6c24e4e0edc'
                    }
                    nm_outputs_sent: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'b5122c93aa8c435bb35684f3009e13ef'
                        deleted: false
                    }
                    nm_outputs_skipped: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '774ba25eb6c942f599d0d3ee72f1a1f0'
                        deleted: true
                    }
                    nm_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '50d5346043974317a430115b17291412'
                        deleted: false
                    }
                    nm_send_email_path: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '72534f405427486587afd43a4b08c12f'
                    }
                    notif_p1_inc_mgr_add_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c34c32910f4e4a9ea6022633e8619457'
                    }
                    notif_p1_inc_mgr_cond_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '72423bed276849b692a6e8e8fb3c7c4a'
                    }
                    notif_p1_inc_mgr_flow: {
                        table: 'sys_hub_flow'
                        id: '0f1e80df2b6e4ecdbc221d0262c231ad'
                    }
                    notif_p1_inc_mgr_no_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '6fed008077784aeeb6cf52c33ca66759'
                    }
                    notif_p1_inc_mgr_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '4109526633904f62a1182c8360b99462'
                    }
                    notif_p1_inc_mgr_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '8f7a60ffb03c4bf3866bc7355cf470a3'
                    }
                    notify_manager_subflow: {
                        table: 'sys_hub_flow'
                        id: 'af90366362d04879b7ab39f6dc66bcc1'
                        deleted: false
                    }
                    p1_network_created_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '75252c5abb284313abe96e750b06fd1c'
                        deleted: true
                    }
                    p1_network_escalation_flow: {
                        table: 'sys_hub_flow'
                        id: 'ee327e93b62847e4901ba23b1b31e03f'
                        deleted: true
                    }
                    p1ne_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '3007e51fe90d4a5481f076baf0c81727'
                        deleted: true
                    }
                    p1ne_call_notify_manager: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: 'f7dbcb6eb9a54f459579ef7277715b07'
                        deleted: true
                    }
                    p1ne_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '589924f0818144e680cd67ef5c3e705b'
                        deleted: true
                    }
                    p1ne_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'cddf7cd2e5e043bb969a360f42cd1c79'
                        deleted: true
                    }
                    p1ne_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'aeeb2f788b7c4b26841fe6510b3f07ab'
                        deleted: true
                    }
                    p1ne_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '761963ae0cc846aca88ee3d44ad00790'
                        deleted: true
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '1fda3d027fcf423e90c0e17dc5298ea2'
                    }
                    send_high_priority_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '322c28009aa244d89bc607cc05da3c7f'
                    }
                    set_assigned_to_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a647d91fdb5b4ab888c63d043486206b'
                    }
                    smoke_test_flow: {
                        table: 'sys_hub_flow'
                        id: '317907f254684c749d9b458f84e30938'
                    }
                    smoke_test_log: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'b360e65e1136400f97f3affc558704b8'
                    }
                    smoke_test_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '061486ac8eda4cc6aa85be20b0eeb565'
                    }
                    triage_high_urgency_incident_flow: {
                        table: 'sys_hub_flow'
                        id: '24be7886e275450a932af7601cb8d420'
                        deleted: true
                    }
                    triage_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '45e24dbc3ebf43309204fcd21bbe1e72'
                        deleted: true
                    }
                    triage_update_incident: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'b366a53ac8e34fdfaa972f7a0139c1c7'
                        deleted: true
                    }
                    trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '2c078fbb556a44f7af14716d8909515e'
                        deleted: true
                    }
                    update: {
                        table: 'sys_hub_action_instance_v2'
                        id: '52f496cb8c114c5ab66ac7c6c86fec58'
                        deleted: true
                    }
                    update_assign_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd4723717f28c4efda14a62aefd5cc56f'
                    }
                    update_demo_flag: {
                        table: 'sys_hub_action_instance_v2'
                        id: '6e4d9feadbf1499892f27f7d8c702d80'
                    }
                    update_work_note_sent: {
                        table: 'sys_hub_action_instance_v2'
                        id: '4a53d57d49f54480994702aff8479add'
                    }
                }
                composite: [
                    {
                        table: 'sys_hub_flow_input'
                        id: '05be1337a3e64852b612e9abab61ae30'
                        deleted: true
                        key: {
                            model: '5f71545a40184eda9b64654f7da65aa7'
                            element: 'message'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0ae44e86ea154e55b763bbb3db25caef'
                        deleted: true
                        key: {
                            name: 'var__m_sys_hub_flow_input_5f71545a40184eda9b64654f7da65aa7'
                            element: 'taskSysId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0b3f84061511408e9ef133fc1de21c86'
                        deleted: false
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'message'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0fdbcb22ec3c4054909d2429563fb05c'
                        deleted: true
                        key: {
                            name: 'var__m_sys_hub_flow_output_5f71545a40184eda9b64654f7da65aa7'
                            element: 'managerEmail'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0ffcd8c7fcb14cc9919c9913ea665589'
                        deleted: false
                        key: {
                            name: 'var__m_sys_hub_flow_output_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'managerEmail'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: '2099b72d75914793a0a69ee53be97379'
                        deleted: true
                        key: {
                            model: '5f71545a40184eda9b64654f7da65aa7'
                            element: 'managerEmail'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '25bdeafeeae443c9b02c5c2047fd7b1e'
                        deleted: false
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskSysId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '364ab96559474ad5bb3db4cc403cfb5a'
                        deleted: false
                        key: {
                            name: 'var__m_sys_hub_flow_output_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'notified'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '534b66eb43bf4841af6863e6d9b0d08a'
                        deleted: true
                        key: {
                            model: '5f71545a40184eda9b64654f7da65aa7'
                            element: 'taskSysId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '8be8eee8f0ab4428a3f0f8baae474bb2'
                        deleted: false
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskSysId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '929075b754e1412c82388065485540ca'
                        deleted: false
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskTable'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: '9d55dacb4524408b8e10d177909044da'
                        deleted: false
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'notified'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: 'a29246d2d3c847f7b25f3a7753997eda'
                        deleted: false
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'managerEmail'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'af8408dc1ec741c98f4213311b48adb3'
                        deleted: false
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskTable'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'b49bf5483c5f49e8a7539ad398cd3ba9'
                        deleted: false
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'message'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'c17cffd9c4514c699acdd2b18fcdb9a3'
                        deleted: true
                        key: {
                            name: 'var__m_sys_hub_flow_output_5f71545a40184eda9b64654f7da65aa7'
                            element: 'notified'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: 'c5aa98e8008f468b92268a5e5753bc8f'
                        deleted: true
                        key: {
                            model: '5f71545a40184eda9b64654f7da65aa7'
                            element: 'notified'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'c86a2a638cff4c9eab5d2c3c7276dbe2'
                        deleted: true
                        key: {
                            model: '5f71545a40184eda9b64654f7da65aa7'
                            element: 'taskTable'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'dd43f6eb45024be1a28deeacfe678fdf'
                        deleted: true
                        key: {
                            name: 'var__m_sys_hub_flow_input_5f71545a40184eda9b64654f7da65aa7'
                            element: 'taskTable'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'fa198438b6224f37a47eb7df9a3a7d57'
                        deleted: true
                        key: {
                            name: 'var__m_sys_hub_flow_input_5f71545a40184eda9b64654f7da65aa7'
                            element: 'message'
                            language: 'en'
                        }
                    },
                ]
            }
        }
    }
}
