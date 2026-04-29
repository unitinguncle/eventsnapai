import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../../constants/colors';
import { Typography } from '../../../constants/typography';

export default function ClientEventScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Client Event View (Phase 2)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },
  title: { ...Typography.h2, color: Colors.textPrimary }
});
