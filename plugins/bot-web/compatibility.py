"""Identify a tested native adapter surface; package metadata is advisory, not a gate."""
from hashlib import sha256
from importlib.metadata import version, PackageNotFoundError
from importlib.util import find_spec
from pathlib import Path

# Each complete fingerprint set was tested against its exact source revision.
# Display/package versions alone cannot authorize a native integration.
SUPPORTED_BUILDS = [{'version': '0.21.0',
  'revision': '29112bef099274229cadff79cdff7bf7b99c4b77',
  'server_requests': False,
  'files': {'methods_session.py': 'c4c0b3355be3ecc7f7fdf8ebcbd46fb3f360f9dded5ca9908f96ed0ce7e561d0',
            'methods_profiles.py': '3846fdf832e3abab7fb3d9b1eafba629da2fd96ff39f9471964490df1697dca4',
            'methods_groups.py': 'f72b3b1768834e276377ed68e2b7efab3d75693da45c22ac06c8be920c19e94c',
            'methods_prompt.py': '01da1128c98ed1f36928a242e447fb42f40a2d0c385a98c1f4c7f6cc756d4b8a',
            'entry.py': 'f46a94f266c1999dc03a3c17c48a25f34f21403c1b1e57b996855c44e0de3e04',
            'server.py': 'e264c1c7cc2e99051c1e36f4019dd29b739d5b7f1c61b8e364f87ad6039d1900',
            'prompt_turn.py': None,
            '../gateway/hosted_rooms.py': '536ac8ce499bdfee2aae6bfcf0e12d3d8d3034fa43dc4a2ab110908a41ec5dfc',
            'methods_tools.py': 'c8bb48e3856dab38a452e9a53e1b30a054925689bccb44ec6a896d16ab88e0d2',
            '../hermes_cli/plugins.py': '63cef01ae81a23c859170d36860c9ac257f320266a88640a8b9690952728bba6',
            '../hermes_cli/plugins_cmd.py': 'fd358229934333bd61c3c9a20e52109ef7e2b78764d6e569badbb127c482a3f0',
            '../hermes_cli/config.py': 'cbce38a2aeed3838dc768d69ee0b31278a211f64bfec66bf786f571c775b3730',
            '../hermes_cli/profiles.py': 'edeafa558cea28cc42ce4e80a21489a3176454a48bae9f767d8c179b954e0981',
            '../hermes_cli/skills_config.py': 'ee053b8474d3038281a765d9817c8606b294e1c6e700239bac10fc3c842e7aaa',
            '../hermes_cli/web_routers/profiles.py': 'f085ec08a6baab407aa238399e93f501b94ce71896d68dd16bb5d3607f523b7c',
            '../hermes_cli/web_server_mcp.py': None,
            '../hermes_cli/web_server.py': 'c56b2f4605f0858704463a4f8ed8f3e44b56bba0f53b0e1839c33a537b4b16f4',
            '../tools/bot_mode_dm.py': '5670404db997c1e4f783ffb27eb07460888910580e05f95052b52ca8d10ff9dc',
            '../tools/mcp_dashboard_oauth.py': '5d4c802cfbac15bcb41340556f71626a1b2a543915006423ec6e5f9b30a1fabb',
            '../tools/mcp_oauth.py': '0cf8740181d06f487fba64e52d98590b92f2e4934c2e635be89caa6d5c39a988',
            '../agent/turn_context.py': '86a4f6c61183167850046b025a8f5c7b8601fb910f8a9ee464535afccc541c06',
            '../agent/turn_finalizer.py': '584ade4613a11565c2ccd48546327adb9682f58ec70ace9d02921c3c240c14d5',
            '../providers/__init__.py': 'eb55ccb80726aa2d4c8f1294a4ca8fdab82fc6f34b8c374b423b821d8012980b',
            '../hermes_state.py': '696fd2d37d66a599228f5b1be5d5b76423b744149c83a2fbd59bf3f45a5f3891',
            '../hermes_state_messages.py': None,
            '../hermes_state_search.py': 'cc7585afd1397240ce82ddcaec7d43a0b21e4871659ff8a50a386dccb582e41d',
            '../hermes_state_compression.py': None,
            '../hermes_cli/profile_identity.py': None,
            'prompt_attachments.py': None,
            'session_history.py': None,
            'methods_display.py': None,
            '../hermes_cli/web_routers/display.py': None,
            '../hermes_cli/dashboard_auth/ws_tickets.py': 'b66e29a067002ad8a345b49281d30c75d6ec2bb177d58214611db66925bb4429',
            '../tools/bot_desktop/runtime.py': None,
            '../tools/bot_desktop/lease.py': None,
            '../tools/bot_desktop/rfb_filter.py': None,
            '../tools/bot_desktop/resources.py': None,
            '../tools/react_to_message_tool.py': '7ec695caadde5479519d6a61b3e8ab9bf7dfd36befdf4e1722e3a5a26ef49fcf',
            '../tools/desktop_ui.py': 'eb196c21ddbb55f49fe68d37cb6655487cb22668a628f8fe167da9f59958386b',
            'methods_config_set.py': None,
            'session_notifications.py': None,
            '../model_tools.py': '5227bfe30f7c3f6eb20d064f648420138031e038d38eac2829d25b749739ad11',
            '../tools/voice_live.py': None,
            '../hermes_cli/web_server_profiles.py': None,
            'agent_callbacks.py': None,
            'server_requests.py': None,
            '../hermes_cli/credential_lifecycle.py': 'eaa2b43724c0e0aab2d7082d73546b611e1ce5b205686113c48cd3877dee2a82',
            '../agent/secret_scope.py': '51d91d280ef05d59c0c450dbfaecd6f50b314a4ff75614cb23b5288a308c645d',
            '../tools/tool_backend_helpers.py': '764d1319d008b154f4b3182712efcdcbebb3e32344a8507ed87dfd10dd75d0eb',
            '../hermes_cli/main.py': 'd635411b110d3a8b26a6298ae90b50ac4bc4b9fd83597afc6fb4b29f05ba1eb5',
            '../cli.py': 'f2c87c8fb552a12face2866869fe671c070983a169c35f953094ff1014a654dc',
            '../hermes_cli/cli_single_query.py': None,
            '../hermes_cli/quiet_single_query.py': None,
            '../agent/turn_author.py': None,
            '../tools/bot_relay.py': '693dcf6525f97f2db5085854d9d7fef196a3bff9a03950c88a23051848fc3794',
            '../tools/environments/local.py': 'ec7fa8cb2f0a0b39f187e18c146a166ee12ed2be3d0a7a66d55ae36a66d28862',
            '../gateway/session_context.py': 'b68908ffec7891b12080933a4d50a63d449479a596335c2579776c6e545c4500',
            '../hermes_cli/middleware.py': 'cae867efa6a5b3c80675f9d7571fb56cea7519a44364bfc9c938c3e5c6f4d5f6',
            '../agent/tool_executor.py': '5aff6c7e95a280adc5124e7c1f1019b54984b8e7091db48bac35ad5bc2387813',
            '../agent/inline_tool_executors.py': None,
            '../agent/agent_runtime_helpers.py': '9164dac169ce580d2de3396885c0959c5660620724f01509416ff2136df890e2',
            '../agent/memory_manager.py': 'a706285f0bbad1cbca57c2c1cf5151ec3fda04e586210333eb6639966b956639',
            '../agent/memory_provider.py': '902e061d33b372cc28facd8c7bf7fe032aacda3f17ea1e4107fea9fd01885335',
            '../hermes_cli/cli_agent_setup_mixin.py': '9468750e93f13a9579cbfea9384ed6d6935ca3bae7a8b89384588f2555c45328',
            '../hermes_cli/cli_init_mixin.py': None,
            '../hermes_state_schema.py': '4093651a0861a6c6108ccca39db3453317a27720bb1374967022ef653ef2436d',
            '../hermes_state_common.py': 'fa07edf0fc394c7a28c68165dd45b974d21dfa2a0da7c3416d6d7ba85fbf2799'}},
 {'version': '0.21.7',
  'revision': 'af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a',
  'server_requests': True,
  'files': {'methods_session.py': 'c1276744175bc4b7ba9e5b400d0334d551e1b5c526b2e1bd71a2786e0a39b669',
            'methods_profiles.py': 'a60c17e15ed84d3aa7c7523fab226b793f0b573888feba3476350ae926be0991',
            'methods_groups.py': '902f79272a8cb391de9f25a2c2acd0d5dbbeaf31654f55e410d36536d77cfce2',
            'methods_prompt.py': '7307dba5aa1df597c99c551b4f344d0e292141e0e6c45f3c3fa2daddb0dbeee9',
            'entry.py': '2d49339eb0b53b9f24243e886c56722ee055335aeae1d19dfc0896cf7b5223bf',
            'server.py': '5e51f2b4ad33af95044be68a001d0ae66948d8c116fe8ff28a8e70b378ca3be1',
            'prompt_turn.py': '11cdd2bd0eaae1e044582c25ef56ee74982c851c5a8cadde0d5cb3961ffa5865',
            '../gateway/hosted_rooms.py': '51c75938d01441e4fceb2fe5f03a9f7e32b53da2c36ab05f20de2405fe19235c',
            'methods_tools.py': '0e98daa609159ac0d7abc45c7d450429f29cbaf7aa5c96d712b1aeb141d7f130',
            '../hermes_cli/plugins.py': 'f5a1c27a22025984bbf956b58154ce23914592307bd945d7a1c0167cc443d771',
            '../hermes_cli/plugins_cmd.py': '25d5f8eb93a125aa13baf43792719d9efec5dda05eb5a8da5a20647b182936fc',
            '../hermes_cli/config.py': 'a469923872fc1e4d905089bb4cc4af5c8cc4104f9f72a159656205c07cdb80ef',
            '../hermes_cli/profiles.py': 'a87c2cb824cbf0f10fb618c282612d0f9263798a9e7962e9223984de05b65c94',
            '../hermes_cli/skills_config.py': '1ee71a1c3d066e57a80eeda67539242d5406dc8cfe45c50edd2ebe7e16a94ee5',
            '../hermes_cli/web_routers/profiles.py': 'd4206f10b6114e7cd8ac1d049a8f69592c7ac83bd8cc473e0c384bc3030fbf14',
            '../hermes_cli/web_server_mcp.py': '5c6fc24bea98f504d9b246aa3bbb3ef064d4585848c74ba3bb1bd0d50c2c9811',
            '../hermes_cli/web_server.py': '14428aa34d4297b81f7dbeb7e8fe2abae0e205a3356d9e341eb22d457ae2e55f',
            '../tools/bot_mode_dm.py': 'f460093a1b91a9eff6152066df6117743cf5d8111ef86f909dd4e52b86d57386',
            '../tools/mcp_dashboard_oauth.py': 'e05456bcd667771f50a7426d18562de2ff063046e73c0afb4fa595a87232f4f9',
            '../tools/mcp_oauth.py': '21f6f2ecbfe2a5a913be9a475704be3c5c69e31a4befa633ce00866aed207cbb',
            '../agent/turn_context.py': '7f22179bf7db0cc3009f24422750e3ec729f0ad4f7253705fd3df3116c75fb3d',
            '../agent/turn_finalizer.py': '9000e17a4a0dba03b1d97cc10fe4184addcca685520ca0c9e6c6ef2cb97d1f25',
            '../providers/__init__.py': '796d3ee0ed3aea06afc21525ec19dc39f17091845fa1e3f9be485acaa058423a',
            '../hermes_state.py': 'b76fc6af3b7f37ee1de1be62379acb08d56069796eaf3bdf253a480be704e578',
            '../hermes_state_messages.py': '5d81a781e61650d04e7d239fae5a59d1aa65632a029b1e14ad9ccb113de93a62',
            '../hermes_state_search.py': '7cab568123f0a11d3b715a1d3fc03e41589cbc40b0e24ae2e7442d6d574f27c2',
            '../hermes_state_compression.py': 'c87bc6345599025e60527428cfddabf9dea8b4584c06e833cb0a2463b954b05c',
            '../hermes_cli/profile_identity.py': '4e5932710a34fa4fc2439ba8b1dfcf75789dfbd2ef26df22074b2e3b6b5b244c',
            'prompt_attachments.py': '212f9a54f67db491a3ef9a7e046bcd4483984f898c05f79a52a6b6ef3284cafa',
            'session_history.py': 'd65e4ef58c2ffd2f84c7aa6312bc4a4d691c7e6b45f18e9ee67e7ce5fa8e193f',
            'methods_display.py': 'b7329a48665d1129f0637250b5facfd4ac2a6735c0d45f8755dbfcc134107849',
            '../hermes_cli/web_routers/display.py': '107bb711192e5d1d6b98dac57ff52b0e0153e4323957aa12ff7e1bff23cc89e2',
            '../hermes_cli/dashboard_auth/ws_tickets.py': '32f8084eb7c0a3dd98c345ee5bc3af974dcbc2f6e671c280026e3a0800c0d3f5',
            '../tools/bot_desktop/runtime.py': '3bb92ff82a31367dec03426b7ed2215c8f34fa8dbcaa9b84ac091ac8276c2884',
            '../tools/bot_desktop/lease.py': '6c49998bed955a236ca90bef1975352a09ae38acb7cb18115fed81c2129a21b9',
            '../tools/bot_desktop/rfb_filter.py': '3e7b31584072f82b0a003f7bcc50b30f42cfab3080301e2c4766de384753f1da',
            '../tools/bot_desktop/resources.py': '5192588306765143fb9037f18ccad3da4c435b17cd07ccb74bdaf2079910e398',
            '../tools/react_to_message_tool.py': 'ed463604f5b2745a3bd9be943cf2678ad86bec39522fef7180da3cfced64f1cf',
            '../tools/desktop_ui.py': '85f98b129953caea991d0b9630d433aef825a543671b6345bbb992b88d6e0f94',
            'methods_config_set.py': '82d5776f2b376112a257bafef642cd6fefdbe4c46d874a52afed27d7c3f2bcf3',
            'session_notifications.py': '3db259fe8d5bbd0a8a9cd5b455304d37f4d434befbaf4e28d41918e8854e65d3',
            '../model_tools.py': '872ca571c17379c8df19c0bcf639919bb0cb3a2706efc08e4dc6a1f3d8789662',
            '../tools/voice_live.py': '9aa0e34b21e26a8c7762bc47de1202803f276c87db665965910032ec894d2446',
            '../hermes_cli/web_server_profiles.py': 'd5a8fdd14de5ad5ce88ab263fc1068bebf2e1692d5a06c8f4f7af6b2024c54b8',
            'agent_callbacks.py': '5d0e901e199ecd807c7d9a8a079ddc7e309e373efed96889f425d8bbdf1df2e1',
            'server_requests.py': 'f1c3e234ac0adea06a831d410db6b579987208080a978ae8b807b8e727fad841',
            '../hermes_cli/credential_lifecycle.py': 'dd8d4ca3e4b31285a376abbeed902ef52a5134abf2075077e90a81cf03585a87',
            '../agent/secret_scope.py': 'e641d7e811d988cb25140005b61d44a82829f0957dd52b8a79c3c9915da80cf2',
            '../tools/tool_backend_helpers.py': '238d2ad2fbfc9f8d5621e7b6ab81990832498d50c766851277323cfefc3a76a2',
            '../hermes_cli/main.py': '577f849585f0c6cf7e29666592810ad9abfba55427ba781f72fb84fee835e80e',
            '../cli.py': '04e9c76fc5596766d4fad1f28a1583ccbc0f9709371dd8a5f60ab91b34105ebb',
            '../hermes_cli/cli_single_query.py': 'e04e0d839c6382c706b7e4fa52b56dab01a82c1df3bd48787093ae270051b9f4',
            '../hermes_cli/quiet_single_query.py': '4d905f1846495dda6994a4da5ba932e2115085b2a7cc0990899408e768c5f567',
            '../agent/turn_author.py': '147ee5f275cfd164e3ef1f00643c0fac53a5faf8fa5db89051710ae394b0939a',
            '../tools/bot_relay.py': '1f2408a68df3aec034b07dc862eef9dd41ac2a7c19729cd2e8cb33847fdb3bdb',
            '../tools/environments/local.py': '0d2beed8699b7c2e38ba1a3982285c7e69c5a5d80c465d88ed4f05e7258cff28',
            '../gateway/session_context.py': '76cb6383168db1c6fd8f70f963e1436b101a9f810f13724cd812bf57a777dbe2',
            '../hermes_cli/middleware.py': '3745ad211f365554a3c070083dc39d3ff9b6cdc93965f13d8796918433ec2328',
            '../agent/tool_executor.py': '8b145fbc70936f028f18e59cb7f9c8723fc992a067fe068f06e7f9f876e9c679',
            '../agent/inline_tool_executors.py': 'ac7ab5c97b070575ab8ecccd6d960b0a418cd4197fed38b764ebc714e880760e',
            '../agent/agent_runtime_helpers.py': '295bd0adcb698ddeb87966f77a79ef1c8016702641db401bfe692ffb63e0dd49',
            '../agent/memory_manager.py': '1df39a53f534a21695ae22fc767245d354b0266da99c28d94fd2b65a5d826ad7',
            '../agent/memory_provider.py': '2d62ab1c2b0de88dd7b4dd4ef87068adc8717800833930782785974edf3ff616',
            '../hermes_cli/cli_agent_setup_mixin.py': '089b319c19146eee0cdb61046a4defed45152276544617bb2a41ccfab6a2f8da',
            '../hermes_cli/cli_init_mixin.py': '8bae4c0f12fb6ef31001cb7a54e63455c9c136e9bb87fe8e920007995730d459',
            '../hermes_state_schema.py': 'ca5f5b7dacc6f0a9401657e1cd4a41b272b0c189132aeec888d35857c2feebb9',
            '../hermes_state_common.py': 'b0f89a8b208f178a97057c820df8fa57689826e006fb9345a38320587b0b2bde'}}]

def inspect_native_adapter():
    try:
        distribution_version = version("hermes-agent")
    except PackageNotFoundError:
        distribution_version = None
    report = {"supported": False, "distribution_version": distribution_version,
              "revision": None, "version": None, "server_requests": False, "fingerprints": {}}
    spec = find_spec("tui_gateway")
    if not spec or not spec.submodule_search_locations:
        report["reason"] = "Native tui_gateway module is unavailable"
        return report
    root = Path(next(iter(spec.submodule_search_locations)))
    for name in SUPPORTED_BUILDS[0]["files"]:
        path = root / name
        report["fingerprints"][name] = sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    for build in SUPPORTED_BUILDS:
        if report["fingerprints"] == build["files"]:
            report.update(supported=True, version=build["version"], revision=build["revision"],
                          server_requests=build["server_requests"])
            return report
    report["reason"] = "Native adapter files do not match a tested source bundle"
    return report


def check_native_adapter():
    report = inspect_native_adapter()
    if not report["supported"]:
        raise RuntimeError("Unsupported native adapter surface. Run hermes bot-web doctor for a read-only compatibility report; do not downgrade or patch Hermes.")
    return report
