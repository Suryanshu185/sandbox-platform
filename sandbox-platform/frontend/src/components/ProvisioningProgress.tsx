import { useEffect, useState } from 'react';
import { Loader2, Download, Box, CheckCircle, AlertCircle } from 'lucide-react';

interface ProvisioningProgressProps {
  status: string;
  phase: string;
  progress?: number;
  progressStatus?: string;
  createdAt: string;
}

export function ProvisioningProgress({ status, phase, progress = 0, progressStatus = '', createdAt }: ProvisioningProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    // Calculate elapsed time from createdAt
    const calculateElapsed = () => {
      const created = new Date(createdAt).getTime();
      const now = Date.now();
      return Math.floor((now - created) / 1000);
    };

    setElapsedTime(calculateElapsed());

    if (status === 'pending' || phase === 'creating' || phase === 'starting') {
      const interval = setInterval(() => {
        setElapsedTime(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, phase, createdAt]);

  const isProvisioning = status === 'pending' || phase === 'creating' || phase === 'starting';
  const isFailed = status === 'error' || phase === 'failed';

  if (!isProvisioning && !isFailed) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Use real progress from backend, or fallback to phase-based estimate
  const displayProgress = isFailed ? 100 : (progress > 0 ? progress : (phase === 'starting' ? 90 : 5));

  return (
    <div className={`rounded-lg p-4 ${isFailed ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
      <div className="flex items-center gap-3 mb-3">
        {isFailed ? (
          <AlertCircle className="w-5 h-5 text-red-500" />
        ) : (
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        )}
        <div className="flex-1">
          <p className={`text-sm font-medium ${isFailed ? 'text-red-700' : 'text-blue-700'}`}>
            {isFailed ? 'Provisioning Failed' : 'Provisioning Sandbox'}
          </p>
          <p className={`text-xs ${isFailed ? 'text-red-600' : 'text-blue-600'}`}>
            {isFailed
              ? 'Check if the image exists and ports are available'
              : `Elapsed: ${formatTime(elapsedTime)} - ${progressStatus || 'Processing...'}`
            }
          </p>
        </div>
        {!isFailed && (
          <span className="text-lg font-bold text-blue-600">{displayProgress}%</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-300 ${
            isFailed
              ? 'bg-red-500'
              : 'bg-blue-500'
          }`}
          style={{ width: `${displayProgress}%` }}
        />
      </div>

      {/* Phase steps */}
      <div className="flex justify-between items-center">
        <PhaseStep
          icon={Download}
          label="Pull Image"
          isActive={phase === 'creating'}
          isComplete={phase === 'starting' || phase === 'healthy'}
          isFailed={isFailed && phase === 'creating'}
        />
        <div className="flex-1 h-0.5 bg-gray-300 mx-2" />
        <PhaseStep
          icon={Box}
          label="Start Container"
          isActive={phase === 'starting'}
          isComplete={phase === 'healthy'}
          isFailed={isFailed && phase === 'starting'}
        />
        <div className="flex-1 h-0.5 bg-gray-300 mx-2" />
        <PhaseStep
          icon={CheckCircle}
          label="Ready"
          isActive={false}
          isComplete={phase === 'healthy'}
          isFailed={false}
        />
      </div>
    </div>
  );
}

interface PhaseStepProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  isComplete: boolean;
  isFailed: boolean;
}

function PhaseStep({ icon: Icon, label, isActive, isComplete, isFailed }: PhaseStepProps) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
          isFailed
            ? 'bg-red-100 text-red-600'
            : isComplete
            ? 'bg-green-100 text-green-600'
            : isActive
            ? 'bg-blue-100 text-blue-600'
            : 'bg-gray-100 text-gray-400'
        }`}
      >
        {isActive && !isFailed ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <span
        className={`text-xs ${
          isFailed
            ? 'text-red-600 font-medium'
            : isActive
            ? 'text-blue-600 font-medium'
            : isComplete
            ? 'text-green-600'
            : 'text-gray-500'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
