import { Pressable, StyleSheet, Text, View } from 'react-native';
import { presentDemoLabs } from './DemoLaboratory';
import type { DemoSession } from './DemoSession';
import { formatDemoDuration } from './DemoTime';

export default function DemoLaboratoryCard({ session, patientId, onOrder, disabled }: Readonly<{
  session: DemoSession; patientId: string; onOrder: () => void; disabled: boolean;
}>) {
  const order = session.laboratory.orders.find(o => o.patientId === patientId);
  const groups = presentDemoLabs(session.laboratory, patientId);
  return <View style={styles.card}><Text style={styles.heading}>Labor · sünteetilised DEMO tulemused</Text>
    <Text>Trauma põhipaneel: Hb, Hct, laktaat, pH, K, Na ja glükoos. Kohalik proov võetakse tellimisel; demo viivitus on 30 simulatsioonisekundit, mitte kliiniline laboriaeg.</Text>
    {session.mode === 'CM' && <Pressable accessibilityRole="button" accessibilityLabel="Telli DEMO trauma põhipaneel"
      disabled={disabled || !!order} onPress={onOrder} style={[styles.button, (disabled || !!order) && styles.disabled]}>
      <Text style={styles.buttonText}>Telli DEMO trauma põhipaneel</Text></Pressable>}
    {!order ? <><Text>Tellimata</Text>{session.mode === 'CM' && disabled && <Text>Tellimiseks käivita simulatsioon ja vali patsient. Paneeli jaoks peab jääma vähemalt 30 simulatsioonisekundit.</Text>}</> : <>
      <Text>Tellimus {order.orderId} · {order.status === 'RESULTED' ? 'Tulemus olemas' : 'Proov võetud · ootel'}</Text>
      <Text>Proov T+{formatDemoDuration(order.orderedAtSimulationTimeSec)}. Kordustellimine pole selles demoetapis saadaval.</Text>
      {groups.map(group => <View key={group.key}><Text style={styles.heading}>{group.title} · {group.statusLabel}</Text>
        <Text>Valmib T+{formatDemoDuration(group.availableAtSimulationTimeSec)}</Text>
        {group.status === 'PROCESSING' ? <Text>Tulemused ootel; paus peatab ka labori ooteaja.</Text> : <>
          <Text>Tulemus {group.key} · T+{formatDemoDuration(group.generatedAtSimulationTimeSec)}</Text>
          <Text>Allikas {group.generationVersion} · ainult sünteetiline demonstratsioon</Text>
          {group.rows.map(row => <View key={row.key}>
            <Text>{row.name}: {row.state === 'RESULT' ? `${row.valueText}${row.unit ? ` ${row.unit}` : ''}` : 'Tulemus puudub'}
              {row.abnormalFlag === 'HIGH' ? ' · KÕRGE' : row.abnormalFlag === 'LOW' ? ' · MADAL' : row.abnormalFlag === 'NORMAL' ? ' · Normis' : ''}</Text>
            {row.referenceRange && <Text>Võrdlusvahemik: {row.referenceRange}</Text>}
          </View>)}
        </>}
      </View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 12, gap: 10, backgroundColor: '#f1f5f9', borderRadius: 12 },
  heading: { fontSize: 18, fontWeight: '700' }, button: { padding: 14, backgroundColor: '#573800', borderRadius: 8 },
  disabled: { opacity: 0.4 }, buttonText: { color: '#fff', fontWeight: '700' } });
