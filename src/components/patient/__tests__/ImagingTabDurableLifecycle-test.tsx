import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ImagingTab from "../ImagingTab";
import type { ImagingStudy } from "@/models/ImagingStudy";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import { sha256Text } from "@/utils/sha256";

const study: ImagingStudy = { id: "P09-CXR", exerciseId: "EX", patientId: "P09", modality: "XR",
  title: "Rindkere röntgen", report: "PREAUTHORED SECRET", status: "processing",
  imageVisibility: "hidden", reportVisibility: "hidden" };
const workflow = (status: "PROCESSING" | "RESULTED"): ImagingWorkflowSnapshot => ({ schemaVersion: 2,
  instances: [{ imagingInstanceId: "IMAGING:CMD", orderCommandId: "CMD", exerciseId: "EX", patientId: "P09",
    definitionId: "P09-CXR", packageId: "pkg", packageVersion: "1", packageHash: "hash", title: study.title,
    modality: "XR", orderedBy: "CM", orderedAtSimulationTimeSec: 0, processingStartedAtSimulationTimeSec: 0,
    availableAtSimulationTimeSec: 60, repeatOrdinal: 1, status,
    authoredSource: { reportText: "RELEASED REPORT", reportSha256: sha256Text("RELEASED REPORT") },
    ...(status === "RESULTED" ? { result: { resultId: "IMAGING_RESULT:IMAGING:CMD",
      imagingInstanceId: "IMAGING:CMD", patientId: "P09", definitionId: "P09-CXR", packageId: "pkg",
      packageVersion: "1", packageHash: "hash", reportText: "RELEASED REPORT",
      authoredReportSha256: sha256Text("RELEASED REPORT"), releasedAtSimulationTimeSec: 60 } } : {}) }],
});

describe("I2 durable Imaging presentation", () => {
  test("does not expose authored clinical report before RESULTED", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ImagingTab studies={[study]}
      workflow={workflow("PROCESSING")} onOpenImage={jest.fn()} onOpenReport={jest.fn()} />); });
    const text = renderer.root.findAllByType("Text" as never).map(node => node.props.children).join(" ");
    expect(text).not.toContain("PREAUTHORED SECRET"); expect(text).toContain("Raport ei ole veel avaldatud");
  });

  test("shows only the immutable instance result after RESULTED", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ImagingTab studies={[study]}
      workflow={workflow("RESULTED")} onOpenImage={jest.fn()} onOpenReport={jest.fn()} />); });
    const text = renderer.root.findAllByType("Text" as never).map(node => node.props.children).join(" ");
    expect(text).toContain("RELEASED REPORT"); expect(text).not.toContain("PREAUTHORED SECRET");
  });
});
