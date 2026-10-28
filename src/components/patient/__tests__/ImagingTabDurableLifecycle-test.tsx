import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ImagingTab from "../ImagingTab";
import type { ImagingStudy } from "@/models/ImagingStudy";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import { sha256Text } from "@/utils/sha256";
import ImageViewer from "@/components/viewers/ImageViewer";
import { ImagingWorkflowRuntime } from "@/services/runtime/imaging/ImagingWorkflowRuntime";
import { DEMO_HEAD_CT_ASSET } from "@/services/imaging/ImagingAssetRegistry";

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
    expect(text).toContain("Töötlemisel"); expect(text).not.toContain("Tundmatu olek");
  });

  test("shows only the immutable instance result after RESULTED", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ImagingTab studies={[study]}
      workflow={workflow("RESULTED")} onOpenImage={jest.fn()} onOpenReport={jest.fn()} />); });
    const text = renderer.root.findAllByType("Text" as never).map(node => node.props.children).join(" ");
    expect(text).toContain("RELEASED REPORT"); expect(text).not.toContain("PREAUTHORED SECRET");
    expect(text).toContain("Tulemus olemas"); expect(text).not.toContain("Tundmatu olek");
  });

  test("staged canonical image appears at seven; report stays hidden until ten", async () => {
    const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "STAGED-UI", exerciseId: "EX", patientId: "P09", orderedBy: "CM",
      orderedAtSimulationTimeSec: 0, definition: { definitionId: study.id, patientId: "P09", title: study.title,
        modality: "XR", reportSource: "REPORT AT TEN", asset: DEMO_HEAD_CT_ASSET,
        imageDelaySeconds: 420, delaySeconds: 600, packageId: "pkg", packageVersion: "1", packageHash: "hash" } });
    let renderer!: TestRenderer.ReactTestRenderer;
    const props = { studies: [study], onOpenImage: jest.fn(), onOpenReport: jest.fn(), readOnly: true };
    runtime.advanceTo(419);
    await act(async () => { renderer = TestRenderer.create(<ImagingTab {...props} workflow={runtime.snapshot()} />); });
    const text = () => renderer.root.findAllByType("Text" as never).map(node => node.props.children).join(" ");
    expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(0);
    expect(text()).not.toContain("REPORT AT TEN"); expect(text()).not.toContain("PREAUTHORED SECRET");
    runtime.advanceTo(420);
    await act(async () => { renderer.update(<ImagingTab {...props} workflow={runtime.snapshot()} />); });
    expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(1);
    expect(text()).toContain("Pilt olemas, kirjeldus ootel");
    expect(text()).toContain("Raport ei ole veel avaldatud"); expect(text()).not.toContain("REPORT AT TEN");
    expect(renderer.root.findAllByType("Pressable" as never)).toHaveLength(0);
    runtime.advanceTo(599);
    await act(async () => { renderer.update(<ImagingTab {...props} workflow={runtime.snapshot()} />); });
    expect(text()).not.toContain("REPORT AT TEN");
    runtime.advanceTo(600);
    await act(async () => { renderer.update(<ImagingTab {...props} workflow={runtime.snapshot()} />); });
    expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(1);
    expect(text()).toContain("REPORT AT TEN"); expect(text()).not.toContain("PREAUTHORED SECRET");
    expect(text()).not.toContain("kirjeldus ootel");
    await act(async () => renderer.unmount());
  });
});
