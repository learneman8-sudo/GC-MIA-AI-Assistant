
import React from 'react';

interface VoiceVisualizerProps {
  isActive: boolean;
  color: string;
}

const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ isActive, color }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full ${color} ${isActive ? 'wave-animation' : 'h-2'}`}
          style={{
            height: isActive ? `${Math.random() * 40 + 10}px` : '4px',
            animationDelay: `${i * 0.1}s`,
            opacity: isActive ? 1 : 0.3
          }}
        />
      ))}
    </div>
  );
};

export default VoiceVisualizer;
