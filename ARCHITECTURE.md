# RussiCaptor Architecture

## Vision

RussiCaptor is a mobile Case Manager platform for mass casualty and disaster
medicine exercises.

The application UI must never depend directly on the data source.

Today:
React Native
↓
DemoDataProvider

Future:
React Native
↓
OneDriveProvider
↓
Microsoft Graph
↓
OneDrive / SharePoint

Changing the data source must not require UI changes.

---

# Layers

UI

↓

Repositories

↓

Providers

↓

Data source

---

# Core Domain

Exercise
│
├── Patients
├── Questions
├── Timeline
├── Labs
├── Imaging
├── Notes
├── Orders
└── Users

---

## Patient

Contains only patient identity and current state.

No labs, timeline or questions are stored inside Patient.

---

## Timeline

The audit trail of everything that happens.

Examples:

- Patient assigned
- Question revealed
- Lab released
- Imaging uploaded
- Transfer completed

---

## Questions

Question data is stored separately and linked by patientId.

---

## Labs

Each laboratory result is an independent object.

---

## Imaging

Imaging studies are independent objects.

Attachments will later point to OneDrive files.

---

## Provider abstraction

Repositories never access demo data directly.

Repository

↓

Provider

↓

Data source

Current provider:

DemoDataProvider

Future providers:

- OneDriveProvider
- JsonProvider
- ApiProvider

---

## Long-term goal

Replace DemoDataProvider with OneDriveProvider without modifying the UI.