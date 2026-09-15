# Octane Template Reference

This file lists the current default template sets used by Octane.

Use this as the editing reference for the left Controls dock templates and the desktop Channels preset workspace. Imported CSV channel names are still read from each log file; the labels below are Octane's preset labels and matcher names.

## Main Dock Templates

These are the templates shown in the left Controls dock. They save/load through `octane-templates.json`.

### General

- Engine Speed
- Vehicle Speed
- Accelerator Pedal Sensor #1
- Manifold Gauge Pressure
- Boost Bank 1
- AFR B1
- Ignition Timing
- Coolant Temperature
- Gear

### Fuel

- AFR B1
- AFR B2
- AFR Target Final B1
- AFR Target Final B2
- Fuel Trim Short Term Bank #1
- Fuel Trim Short Term Bank #2
- Injector Duty B1
- Fuel Pressure (relative)
- FlexFuel Ethanol Content

### Ignition

- Ignition Timing
- Knock Correction
- Knock Sensor Cylinder 1
- Knock Sensor Cylinder 2
- Knock Sensor Cylinder 3
- Knock Sensor Cylinder 4
- Knock Sensor Cylinder 5
- Knock Sensor Cylinder 6
- Engine Speed
- Manifold Gauge Pressure

### Speed

- Vehicle Speed
- Wheel Speed FL
- Wheel Speed FR
- Wheel Speed RL
- Wheel Speed RR
- Wheel Slip Ratio
- Gear
- Accelerator Pedal Sensor #1
- 4WD Torque Split

## Channels Presets And Graphs

These are the default Channels layout presets. They save/load through `octane-channels-layout.json`.

### General Tuning

Graph: Engine / Air
- RPM
- MAP
- TPS
- Coolant temp
- Battery voltage

Graph: Fuel / Ignition
- Lambda / AFR
- Fuel trim short
- Fuel trim long
- Fuel duty
- Fuel pressure
- Ignition angle

### Idle

Graph: Idle Control
- RPM
- MAP
- Throttle
- Accelerator
- Idle control
- Battery voltage

Graph: Fuel / Heat
- Lambda / AFR
- Short trim
- Long trim
- Ignition timing
- Coolant temp
- IAT

### Boost

Graph: Boost Response
- RPM
- Gear
- MAP
- Boost target
- Boost bank 1
- Boost bank 2
- Boost error
- Atmospheric pressure

Graph: Wastegate / Airflow
- Wastegate duty
- WG base
- WG proportional
- WG integral
- Throttle
- IAT

### VVT

Graph: Cam Control
- RPM
- Engine load
- Intake cam
- Exhaust cam
- VVT target
- VVT duty

Graph: Oil / Heat
- Oil pressure
- Oil temp
- Coolant temp

### E-Throttle

Graph: Pedal / Throttle
- Accelerator pedal
- Throttle bank 1
- Throttle bank 2
- Throttle target
- Throttle duty

Graph: Torque / Load
- RPM
- MAP
- Torque

### Temps

Graph: Temperature Stack
- Coolant temp
- IAT
- Oil temp
- Transmission temp
- Fuel temp
- EGT
- Catalyst temp
- Ambient temp

### Wheel Speeds

Graph: Wheel Speeds
- Vehicle speed
- Front left
- Front right
- Rear left
- Rear right

Graph: Stability
- Gear
- Traction / slip

### GR6

Graph: Shift State
- Gear
- Shift status
- Torque reduction

Graph: Speed / Slip
- Clutch speed
- Input shaft
- Output shaft
- Clutch slip

Graph: Pressure / Heat
- Transmission temp
- Clutch pressure
- Line pressure
- Solenoid

### Clutch Speeds

Graph: Clutch Speeds
- RPM
- Gear
- Clutch A speed
- Clutch B speed
- Input shaft
- Output shaft
- Clutch slip

### Clutch Temps

Graph: Clutch Heat
- Clutch A temp
- Clutch B temp
- Transmission temp
- Oil temp
- Gear
- Clutch slip

### All Temps

Graph: All Temperatures
- Temperature channels

### Ethanol

Graph: Fuel / Ethanol
- Ethanol content
- Fuel pressure
- Fuel temp
- Fuel trim short
- Fuel trim long
- Injector duty

Graph: Combustion
- Lambda / AFR
- AFR target
- Ignition timing
- Boost / MAP

## All Default Plot Names

Main app views:
- Signal Matrix
- Analysis Plot
- Channels
- Compare

Analysis plot panes:
- Overlay
- Plot 1
- Plot 2

Channels graph names:
- Engine / Air
- Fuel / Ignition
- Idle Control
- Fuel / Heat
- Boost Response
- Wastegate / Airflow
- Cam Control
- Oil / Heat
- Pedal / Throttle
- Torque / Load
- Temperature Stack
- Wheel Speeds
- Stability
- Shift State
- Speed / Slip
- Pressure / Heat
- Clutch Speeds
- Clutch Heat
- All Temperatures
- Fuel / Ethanol
- Combustion

## All Preset Channel Labels

These are the channel labels used by the default Channels presets. They can point to exact CSV channels or to matcher groups that find compatible log channels.

- Accelerator
- Accelerator pedal
- AFR target
- Ambient temp
- Atmospheric pressure
- Battery voltage
- Boost / MAP
- Boost bank 1
- Boost bank 2
- Boost error
- Boost target
- Catalyst temp
- Clutch A speed
- Clutch A temp
- Clutch B speed
- Clutch B temp
- Clutch pressure
- Clutch slip
- Clutch speed
- Coolant temp
- EGT
- Engine load
- Ethanol content
- Exhaust cam
- Front left
- Front right
- Fuel duty
- Fuel pressure
- Fuel temp
- Fuel trim long
- Fuel trim short
- Gear
- IAT
- Idle control
- Ignition angle
- Ignition timing
- Injector duty
- Input shaft
- Intake cam
- Lambda / AFR
- Line pressure
- Long trim
- MAP
- Oil pressure
- Oil temp
- Output shaft
- RPM
- Rear left
- Rear right
- Shift status
- Short trim
- Solenoid
- Temperature channels
- Throttle
- Throttle bank 1
- Throttle bank 2
- Throttle duty
- Throttle target
- Torque
- Torque reduction
- TPS
- Traction / slip
- Transmission temp
- Vehicle speed
- VVT duty
- VVT target
- Wastegate duty
- WG base
- WG integral
- WG proportional

## Export Formats

### Dock Templates

```json
{
  "app": "octane",
  "kind": "templates",
  "version": 1,
  "templates": [
    {
      "id": "template-id",
      "name": "Template name",
      "channels": ["Channel label 1", "Channel label 2"]
    }
  ]
}
```

### Channels Layout

```json
{
  "app": "octane",
  "kind": "channels-layout",
  "version": 1,
  "presets": [
    {
      "id": "general",
      "name": "General tuning"
    }
  ],
  "groupsByPreset": {
    "general": [
      {
        "id": "engine-air",
        "title": "Engine / Air",
        "labels": ["RPM", "MAP", "TPS"]
      }
    ]
  }
}
```
