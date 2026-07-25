export function createSecretDenial({ action = "filesystem.read" } = {}) {
  return {
    status: "RED_BLOCK_SECRET_PATH",
    action,
    resource_class: "TARGET_SECRET",
    path_disclosed: false,
    content_returned: false,
    bytes_returned: 0,
    retry_same_action: false,
    safe_next_actions: ["bootstrap_inspect_target", "bootstrap_dry_run"],
  }
}
export function createCapabilityDenial({ action, status = "RED_BLOCK_CAPABILITY_DENIED" }) {
  return {
    status,
    action,
    path_disclosed: false,
    content_returned: false,
    bytes_returned: 0,
    retry_same_action: false,
    safe_next_actions: ["bootstrap_get_status"],
  }
}
