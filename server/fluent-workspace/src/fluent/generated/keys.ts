import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '39e89ebd1f99428e9dab343b4b3f0248'
                    }
                    daily_p1_digest_flow: {
                        table: 'sys_hub_flow'
                        id: 'b2f18c963fd244f6a02895a7a6359536'
                    }
                    dpd_any_found: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '0cb679e794b2426190e6e12134d295c5'
                    }
                    dpd_each: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '440ea76341dc427393923d9fbf62ea5c'
                    }
                    dpd_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '69243c878a7c4623ab70a0ba1011d58a'
                    }
                    dpd_log_each: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c91600547a1040f4884355698b172d27'
                    }
                    dpd_log_none: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e77eed075dbe40c98848afad5ce15f87'
                    }
                    dpd_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e20f71c8d6804fb89b64b3553610ad58'
                    }
                    dpd_none: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'f78977d00e334a91a17951ce4c8b597e'
                    }
                    dpd_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'f08c35b8fb92486194178b5f8be6caab'
                    }
                    nm_has_manager_email: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '9fefd0dca0a2419ba26d1f90a310f6bd'
                    }
                    nm_log_no_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '8e05308fe5084b28aebba5ae0c366391'
                    }
                    nm_lookup_task: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ad24da89756847f6a00acf83fd95fad0'
                    }
                    nm_no_manager: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'd1eeb79b78ea4159ae82866dc409ef2c'
                    }
                    nm_outputs_sent: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'b5122c93aa8c435bb35684f3009e13ef'
                    }
                    nm_outputs_skipped: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '774ba25eb6c942f599d0d3ee72f1a1f0'
                    }
                    nm_send_email: {
                        table: 'sys_hub_action_instance_v2'
                        id: '50d5346043974317a430115b17291412'
                    }
                    notify_manager_subflow: {
                        table: 'sys_hub_flow'
                        id: 'af90366362d04879b7ab39f6dc66bcc1'
                    }
                    p1_network_escalation_flow: {
                        table: 'sys_hub_flow'
                        id: 'ee327e93b62847e4901ba23b1b31e03f'
                    }
                    p1ne_assign_manager: {
                        table: 'sys_hub_action_instance_v2'
                        id: '3007e51fe90d4a5481f076baf0c81727'
                    }
                    p1ne_call_notify_manager: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: 'f7dbcb6eb9a54f459579ef7277715b07'
                    }
                    p1ne_lookup_group: {
                        table: 'sys_hub_action_instance_v2'
                        id: '589924f0818144e680cd67ef5c3e705b'
                    }
                    p1ne_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'cddf7cd2e5e043bb969a360f42cd1c79'
                    }
                    p1ne_unassigned: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'aeeb2f788b7c4b26841fe6510b3f07ab'
                    }
                    p1ne_work_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '761963ae0cc846aca88ee3d44ad00790'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '1fda3d027fcf423e90c0e17dc5298ea2'
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
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '0b3f84061511408e9ef133fc1de21c86'
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'message'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0ffcd8c7fcb14cc9919c9913ea665589'
                        key: {
                            name: 'var__m_sys_hub_flow_output_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'managerEmail'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '25bdeafeeae443c9b02c5c2047fd7b1e'
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskSysId'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '364ab96559474ad5bb3db4cc403cfb5a'
                        key: {
                            name: 'var__m_sys_hub_flow_output_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'notified'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '8be8eee8f0ab4428a3f0f8baae474bb2'
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskSysId'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '929075b754e1412c82388065485540ca'
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskTable'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: '9d55dacb4524408b8e10d177909044da'
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'notified'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: 'a29246d2d3c847f7b25f3a7753997eda'
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'managerEmail'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'af8408dc1ec741c98f4213311b48adb3'
                        key: {
                            name: 'var__m_sys_hub_flow_input_af90366362d04879b7ab39f6dc66bcc1'
                            element: 'taskTable'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'b49bf5483c5f49e8a7539ad398cd3ba9'
                        key: {
                            model: 'af90366362d04879b7ab39f6dc66bcc1'
                            element: 'message'
                        }
                    },
                ]
            }
        }
    }
}
