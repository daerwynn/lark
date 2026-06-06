export interface MicMonitorStatus {
  capture_active: boolean;
  monitor_enabled: boolean;
  monitor_gain: number;
  monitor_queue_samples: number;
  monitor_queue_latency_ms: number;
  input_device_name: string | null;
  output_device_name: string | null;
  input_buffer_size: string | null;
  output_buffer_size: string | null;
}
