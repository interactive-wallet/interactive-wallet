import 'package:flutter/material.dart';

IconData messageIcon(String type) {
  switch (type) {
    case 'credentialOffer':
      return Icons.card_membership_rounded;
    case 'proofRequest':
      return Icons.policy_outlined;
    case 'connectionInvite':
      return Icons.link_rounded;
    case 'trustPing':
      return Icons.wifi_tethering_rounded;
    case 'problemReport':
      return Icons.error_outline_rounded;
    default:
      return Icons.message_outlined;
  }
}

String messageTitle(String type) {
  switch (type) {
    case 'credentialOffer':
      return 'Credential Offer';
    case 'proofRequest':
      return 'Proof Request';
    case 'connectionInvite':
      return 'Connection Invite';
    case 'trustPing':
      return 'Trust Ping';
    case 'problemReport':
      return 'Problem Report';
    default:
      return type;
  }
}

String truncateDid(String did) {
  if (did.length <= 34) return did;
  return '${did.substring(0, 20)}...${did.substring(did.length - 8)}';
}

String shortDid(String did) {
  if (did.length <= 20) return did;
  return '${did.substring(0, 12)}...${did.substring(did.length - 6)}';
}
