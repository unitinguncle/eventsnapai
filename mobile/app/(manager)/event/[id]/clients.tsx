import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';

export default function ClientsTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset Password State
  const [showResetForm, setShowResetForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const fetchClients = async () => {
    try {
      const res = await api.get(`/events/${eventId}/clients`);
      setClients(res.data);
    } catch (err: any) {
      console.error(err);
      Alert.alert('Error', err.response?.data?.error || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [eventId]);

  const handleCreate = async () => {
    if (!name || !username || !password || !mobile) {
      Alert.alert('Missing Fields', 'Name, username, password, and mobile are required.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Invalid Password', 'Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/users', {
        displayName: name,
        username: username.toLowerCase().trim(),
        password,
        role: 'user',
        eventId,
        mobile,
        phone: '',
        email
      });
      Alert.alert('Success', `Client account ${username} created!`);
      setName(''); setUsername(''); setPassword(''); setMobile(''); setEmail('');
      fetchClients();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitResetPassword = async (clientId: string) => {
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    setIsResetting(true);
    try {
      await api.put(`/users/${clientId}/password`, { password: newPassword });
      Alert.alert('Success', 'Client password reset successfully.');
      setShowResetForm(false);
      setNewPassword('');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to reset password');
    } finally {
      setIsResetting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {clients.length > 0 ? (
        <View style={styles.existingClientCard}>
          <View style={styles.clientHeader}>
            <Ionicons name="person-circle" size={48} color={Colors.accent} />
            <View style={{ marginLeft: Spacing.md }}>
              <Text style={styles.clientName}>{clients[0].display_name}</Text>
              <Text style={styles.clientUsername}>@{clients[0].username}</Text>
            </View>
          </View>
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={Colors.textSecondary} />
            <Text style={styles.infoText}>
              This event already has a dedicated client account. They can log in to view their private gallery.
            </Text>
          </View>
          
          {!showResetForm ? (
            <TouchableOpacity 
              style={styles.resetBtn} 
              onPress={() => setShowResetForm(true)}
            >
              <Ionicons name="key" size={20} color={Colors.textPrimary} />
              <Text style={styles.resetBtnText}>Reset Password</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.resetForm}>
              <Text style={styles.label}>New Password (min 6)</Text>
              <TextInput 
                style={styles.input} 
                value={newPassword} 
                onChangeText={setNewPassword} 
                secureTextEntry 
                placeholder="New password" 
                placeholderTextColor={Colors.textSecondary} 
              />
              <View style={styles.resetActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowResetForm(false); setNewPassword(''); }}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmResetBtn} onPress={() => submitResetPassword(clients[0].id)} disabled={isResetting}>
                  {isResetting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmResetText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Client Account</Text>
          <Text style={styles.formSubtitle}>Give your client private access to their event photos.</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Display Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="John & Jane's Wedding" placeholderTextColor={Colors.textSecondary} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username *</Text>
            <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="johnjane2024" placeholderTextColor={Colors.textSecondary} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password * (min 6)</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="******" placeholderTextColor={Colors.textSecondary} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mobile Number *</Text>
            <TextInput style={styles.input} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="+1 555-0100" placeholderTextColor={Colors.textSecondary} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address (Optional)</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="john@example.com" placeholderTextColor={Colors.textSecondary} />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Create Account</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: Spacing.xl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },
  
  existingClientCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  clientName: {
    ...Typography.h3,
    color: Colors.textPrimary,
  },
  clientUsername: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: Colors.bgSurface2,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  infoText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    flex: 1,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgSurface2,
    padding: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  resetBtnText: {
    ...Typography.button,
    color: Colors.textPrimary,
  },
  resetForm: {
    backgroundColor: Colors.bgSurface2,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  resetActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  cancelBtn: {
    flex: 1,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    ...Typography.button,
    color: Colors.textPrimary,
  },
  confirmResetBtn: {
    flex: 1,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
  },
  confirmResetText: {
    ...Typography.button,
    color: '#fff',
  },

  formCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  formSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  label: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.bgSurface2,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Typography.body,
  },
  submitBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  submitBtnText: {
    ...Typography.button,
    color: '#fff',
  },
});
