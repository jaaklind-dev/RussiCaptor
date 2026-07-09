import ImageViewer from "@/components/viewers/ImageViewer";
import { t } from "@/locales";
import { ImagingStudy } from "@/models/ImagingStudy";
import { getStatusLabel } from "@/utils/status";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  studies: ImagingStudy[];
  onOpenImage: (study: ImagingStudy) => void;
  onOpenReport: (study: ImagingStudy) => void;
};

export default function ImagingTab({
  studies,
  onOpenImage,
  onOpenReport,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t.imaging.title}</Text>

      {studies.length === 0 ? (
        <Text style={styles.empty}>{t.common.noData}</Text>
      ) : (
        studies.map((study) => (
          <View key={study.id} style={styles.study}>
            <View style={styles.header}>
              <View>
                <Text style={styles.studyTitle}>{study.title}</Text>
                <Text style={styles.status}>
                  {getStatusLabel(study.status)}
                </Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              {study.attachment && study.imageVisibility !== "revealed" && (
                <Pressable
                  style={styles.button}
                  onPress={() => onOpenImage(study)}
                >
                  <Text style={styles.buttonText}>Ava pilt</Text>
                </Pressable>
              )}

              {study.reportVisibility !== "revealed" && (
                <Pressable
                  style={styles.button}
                  onPress={() => onOpenReport(study)}
                >
                  <Text style={styles.buttonText}>Ava raport</Text>
                </Pressable>
              )}
            </View>

            {study.imageVisibility === "revealed" &&
              study.attachment === "image01.jpg" && (
                <ImageViewer
                  source={require("../../../assets/imaging/image01.jpg")}
                />
              )}

            {study.reportVisibility === "revealed" ? (
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