import ImageViewer from "@/components/viewers/ImageViewer";
import { t } from "@/locales";
import { ImagingStudy } from "@/models/ImagingStudy";
import { getStatusLabel } from "@/utils/status";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import type { ImagingAssetReference } from "@/models/ImagingAsset";
import { classifyLegacyImagingAttachment, resolveImagingAsset } from "@/services/imaging/ImagingAssetRegistry";
type Props = {
  studies: ImagingStudy[];
  onOpenImage: (study: ImagingStudy) => void;
  onOpenReport: (study: ImagingStudy) => void;
  readOnly?: boolean;
  workflow?: ImagingWorkflowSnapshot;
};

const ReleasedAsset = ({ asset }: { asset: ImagingAssetReference }) => {
  const resolution = resolveImagingAsset(asset);
  return resolution.status === "RESOLVED" ? <ImageViewer source={resolution.source} /> : null;
};

export default function ImagingTab({
  studies,
  onOpenImage,
  onOpenReport,
  readOnly = false,
  workflow,
}: Props) {
  const durableDefinitionIds = new Set((workflow?.instances ?? []).map(item => item.definitionId));
  const legacyStudies = workflow ? studies.filter(study => !durableDefinitionIds.has(study.id)) : studies;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t.imaging.title}</Text>

      {(workflow?.instances ?? []).map(instance => (
        <View key={instance.imagingInstanceId} style={styles.study}>
          <Text style={styles.studyTitle}>{instance.title} #{instance.repeatOrdinal}</Text>
          <Text style={styles.status}>{instance.status}</Text>
          {instance.status === "RESULTED" && instance.result ? (
            <>
              <Text style={styles.report}>{instance.result.reportText}</Text>
              {instance.result.asset ? <ReleasedAsset asset={instance.result.asset} /> : null}
            </>
          ) : <Text style={styles.hidden}>Raport ei ole veel avaldatud</Text>}
        </View>
      ))}

      {legacyStudies.length === 0 && !workflow?.instances.length ? (
        <Text style={styles.empty}>{t.common.noData}</Text>
      ) : (
        legacyStudies.map((study) => (
          <View key={study.id} style={styles.study}>
            <View style={styles.header}>
              <View>
                <Text style={styles.studyTitle}>{study.title}</Text>
                <Text style={styles.status}>
                  {workflow ? "Tellitav uuring" : getStatusLabel(study.status)}
                </Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              {!workflow && !readOnly && (study.asset || study.attachment) && study.imageVisibility !== "revealed" && (
                <Pressable
                  style={styles.button}
                  onPress={() => onOpenImage(study)}
                >
                  <Text style={styles.buttonText}>Ava pilt</Text>
                </Pressable>
              )}

             {!workflow && !readOnly && study.status === "viewed" && study.reportVisibility !== "revealed" && (
  <Pressable
    style={styles.button}
    onPress={() => onOpenReport(study)}
  >
    <Text style={styles.buttonText}>Ava raport</Text>
  </Pressable>
)}
</View>

{!workflow && study.imageVisibility === "revealed" && (() => {
  const resolution = study.asset ? resolveImagingAsset(study.asset) : classifyLegacyImagingAttachment(study.attachment);
  return resolution?.status === "RESOLVED" ? <ImageViewer source={resolution.source} /> : null;
})()}
            {!workflow && study.status === "viewed" && study.reportVisibility === "revealed" ? (
              <Text style={styles.report}>{study.report}</Text>
            ) : (
              <Text style={styles.hidden}>Raport on varjatud</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },
  empty: {
    color: "#666",
    fontStyle: "italic",
  },
  study: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    padding: 12,
    marginBottom: 16,
  },
  header: {
    marginBottom: 10,
  },
  studyTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  status: {
    marginTop: 4,
    color: "#666",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#005BBB",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
  report: {
    marginTop: 14,
    lineHeight: 22,
  },
  hidden: {
    marginTop: 14,
    color: "#999",
    fontStyle: "italic",
  },
});
