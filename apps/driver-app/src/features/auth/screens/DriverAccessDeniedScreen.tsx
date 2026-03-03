import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, ScreenContainer, Text } from '@waselneh/ui';
import { DriverEligibilityState, DriverEligibilityReason } from '../../../services/realtime';
import { useI18n } from '../../../localization';

interface DriverAccessDeniedScreenProps {
  eligibility: DriverEligibilityState;
  onOpenSupport: () => void;
}

function getReasonLabel(reason: DriverEligibilityReason, isRTL: boolean): string {
  switch (reason) {
    case 'missing_profile':
      return isRTL
        ? 'لا يوجد ملف سائق معتمد لهذا الحساب.'
        : 'No approved driver profile was found for this account.';
    case 'invalid_driver_type':
      return isRTL
        ? 'نوع السائق يجب أن يكون مالك خط مرخّص.'
        : "Driver type must be 'licensed_line_owner'.";
    case 'driver_not_approved':
      return isRTL
        ? 'حالة التحقق ليست Approved.'
        : "Verification status must be 'approved'.";
    case 'missing_line_or_license_link':
      return isRTL
        ? 'يجب ربط الحساب بـ lineId أو licenseId صالح.'
        : 'A valid lineId or licenseId link is required.';
    default:
      return isRTL ? 'الحساب غير مؤهل للتشغيل.' : 'Account is not eligible to operate.';
  }
}

export function DriverAccessDeniedScreen({
  eligibility,
  onOpenSupport,
}: DriverAccessDeniedScreenProps) {
  const { isRTL } = useI18n();

  return (
    <ScreenContainer padded={false} style={styles.container}>
      <View style={styles.page}>
        <Card elevated style={styles.card}>
          <Text variant="h2" style={styles.title}>
            {isRTL ? 'الحساب غير مؤهل للتشغيل' : 'Account Not Eligible'}
          </Text>
          <Text style={styles.subtitle}>
            {isRTL
              ? 'التطبيق مخصص فقط لمالك الخط المرخص بعد اعتماد التحقق وربط الرخصة.'
              : 'This app is available only for approved licensed line owners linked to a valid line/license.'}
          </Text>

          <View style={styles.reasons}>
            {eligibility.reasons.map((reason) => (
              <Text key={reason} style={styles.reasonItem}>
                • {getReasonLabel(reason, isRTL)}
              </Text>
            ))}
          </View>

          <View style={styles.metaBox}>
            <Text style={styles.metaText}>
              {isRTL ? 'driverType:' : 'driverType:'} {eligibility.driverType ?? '-'}
            </Text>
            <Text style={styles.metaText}>
              {isRTL ? 'verificationStatus:' : 'verificationStatus:'} {eligibility.verificationStatus ?? '-'}
            </Text>
            <Text style={styles.metaText}>
              {isRTL ? 'lineId:' : 'lineId:'} {eligibility.lineId ?? '-'}
            </Text>
            <Text style={styles.metaText}>
              {isRTL ? 'licenseId:' : 'licenseId:'} {eligibility.licenseId ?? '-'}
            </Text>
          </View>

          <Button
            title={isRTL ? 'فتح الدعم' : 'Open Support'}
            onPress={onOpenSupport}
            style={styles.supportButton}
          />
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#EEF3FB',
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: 20,
    borderColor: '#E2E8F0',
    borderWidth: 1,
    gap: 12,
  },
  title: {
    color: '#0F172A',
  },
  subtitle: {
    color: '#334155',
    lineHeight: 22,
    fontSize: 15,
  },
  reasons: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  reasonItem: {
    color: '#991B1B',
    fontSize: 13,
    lineHeight: 19,
  },
  metaBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  metaText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  supportButton: {
    marginTop: 6,
  },
});

