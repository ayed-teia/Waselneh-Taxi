import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Button, Header, ScreenContainer, Text } from '@waselneh/ui';
import { createSupportTicket } from '../src/services/api';
import { useAuthStore } from '../src/store';
import { useI18n } from '../src/localization';

export default function Support() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert(
        isRTL ? 'حقول ناقصة' : 'Missing fields',
        isRTL ? 'الرجاء إدخال العنوان والرسالة.' : 'Please provide both subject and message.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSupportTicket({
        category: 'technical',
        subject: subject.trim(),
        message: message.trim(),
      });
      Alert.alert(
        isRTL ? 'تم فتح تذكرة' : 'Ticket created',
        isRTL
          ? `تم فتح تذكرة الدعم ${result.ticketId.slice(0, 8)}.`
          : `Support ticket ${result.ticketId.slice(0, 8)} has been opened.`
      );
      router.replace('/home');
    } catch (error) {
      Alert.alert(
        isRTL ? 'فشل' : 'Failed',
        error instanceof Error ? error.message : isRTL ? 'تعذر إنشاء تذكرة الدعم.' : 'Could not create support ticket.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'الدعم' : 'Support'}
        subtitle={isRTL ? 'افتح تذكرة تشغيل' : 'Open an operations ticket'}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
      />

      <View style={styles.content}>
        <Text style={styles.label}>{isRTL ? 'العنوان' : 'Subject'}</Text>
        <TextInput
          style={styles.input}
          placeholder={isRTL ? 'دعم العمليات' : 'Dispatch support'}
          value={subject}
          onChangeText={setSubject}
          editable={!submitting}
        />

        <Text style={styles.label}>{isRTL ? 'الرسالة' : 'Message'}</Text>
        <TextInput
          style={styles.textArea}
          placeholder={isRTL ? 'اشرح المشكلة...' : 'Describe your issue...'}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={6}
          editable={!submitting}
          textAlignVertical="top"
          maxLength={1500}
        />

        <Button
          title={submitting ? (isRTL ? 'جاري الإرسال...' : 'Submitting...') : isRTL ? 'فتح تذكرة' : 'Open ticket'}
          onPress={submit}
          loading={submitting}
          disabled={submitting}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  textArea: {
    minHeight: 130,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    fontSize: 14,
  },
});
