import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { TripChatMessage } from '../../../services/realtime';

const QUICK_REPLIES = ['I am at pickup', 'Please wait 2 minutes', 'Call me when near'];

interface TripChatPanelProps {
  messages: TripChatMessage[];
  myRole: 'passenger' | 'driver';
  onSend: (message: string, quickReply?: boolean) => void;
  sending?: boolean;
}

export function TripChatPanel({ messages, myRole, onSend, sending = false }: TripChatPanelProps) {
  const [draft, setDraft] = useState('');
  const recent = useMemo(() => messages.slice(-8), [messages]);

  const submit = (text: string, quickReply = false) => {
    const normalized = text.trim();
    if (!normalized) return;
    onSend(normalized, quickReply);
    if (!quickReply) setDraft('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>In-app chat</Text>
      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {recent.length === 0 ? (
          <Text style={styles.empty}>No messages yet.</Text>
        ) : (
          recent.map((message) => {
            const isMine = message.senderRole === myRole;
            return (
              <View key={message.id} style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
                <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{message.text}</Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.quickReplies}>
        {QUICK_REPLIES.map((reply) => (
          <Pressable key={reply} onPress={() => submit(reply, true)} style={styles.quickChip}>
            <Text style={styles.quickChipText}>{reply}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.compose}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message"
          style={styles.input}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={() => submit(draft)}
          disabled={sending}
        >
          <Text style={styles.sendText}>{sending ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  messages: {
    maxHeight: 132,
  },
  messagesContent: {
    gap: 6,
    paddingVertical: 2,
  },
  empty: {
    fontSize: 12,
    color: '#94A3B8',
  },
  bubble: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '88%',
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#E2E8F0',
  },
  bubbleText: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
  },
  bubbleTextMine: {
    color: '#FFFFFF',
  },
  quickReplies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  quickChipText: {
    fontSize: 11,
    color: '#1D4ED8',
    fontWeight: '700',
  },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  sendButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D4ED8',
  },
  sendButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
