import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { router } from 'expo-router';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';

export default function ClientDashboard() {
  const { user, logout } = useAuth();
  
  useEffect(() => {
    if (!user) {
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    }
  }, [user]);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Client Dashboard (Phase 2)</Text>
      <TouchableOpacity style={styles.btn} onPress={handleLogout}>
        <Text style={styles.btnText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },
  title: { ...Typography.h2, color: Colors.textPrimary, marginBottom: 20 },
  btn: { backgroundColor: Colors.error, padding: 12, borderRadius: 8 },
  btnText: { color: '#fff' }
});
