/** Declared implementation capabilities, not proof of a device acceptance test. */
export function gatewayCapabilities(platform) {
  const desktop=['darwin','win32'].includes(platform);
  return Object.freeze({platform,localListener:desktop,lanListener:false,
    systemProxy:platform==='darwin'?'network-services':platform==='win32'?'current-user':'unavailable',
    peerProof:platform==='darwin'?'tcp-uid-signature':platform==='win32'?'tcp-sid-signature':'unavailable',
    manualProxyCoexistence:desktop,automaticProxyCoexistence:false,
    nativeMiniPrograms:desktop?'signed-client-bridge':'native-platform-bridge-required',
    operatingSystemApproval:desktop?'certificate-trust':'vpn-or-managed-proxy-and-certificate',
    exclusiveVpn:platform==='android',
  });
}
