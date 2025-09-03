import React, { useState, useRef, useEffect } from 'react';

const PadController = ({ audioContext, masterGain, onPadTrigger, socket, sessionCode }) => {
  const [pads, setPads] = useState([]);
  const [activePads, setActivePads] = useState(new Set());
  const [selectedPreset, setSelectedPreset] = useState('warm_pads');
  const oscillatorsRef = useRef({});
  const lastFrequencyRef = useRef(null); // For portamento
  
  // Pad sound presets with different octaves and styles
  const padPresets = {
    warm_pads: {
      name: 'Warm Pads',
      color: '#ff6b35',
      octave: 3, // Mid-range
      oscillatorType: 'sawtooth',
      filterType: 'lowpass',
      filterFreq: 1200,
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.8 }
    },
    crystal_bells: {
      name: 'Crystal Bells', 
      color: '#4ecdc4',
      octave: 5, // Higher octave
      oscillatorType: 'triangle',
      filterType: 'highpass',
      filterFreq: 800,
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 1.5 }
    },
    deep_bass: {
      name: 'Deep Bass',
      color: '#45b7d1', 
      octave: 2, // Lower octave
      oscillatorType: 'sine',
      filterType: 'lowpass',
      filterFreq: 300,
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.6 }
    },
    punchy_leads: {
      name: 'Punchy Leads',
      color: '#f7931e',
      octave: 4, // Mid-high range  
      oscillatorType: 'square',
      filterType: 'bandpass',
      filterFreq: 2000,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0.3, release: 0.6 },
      // Enhanced effects for punchy leads
      reverb: { wet: 0.6, roomSize: 0.8 },
      delay: { time: 0.125, feedback: 0.4, wet: 0.3 },
      portamento: 0.02 // 20ms glide time
    }
  };
  
  // Base note frequencies (C major scale)
  const baseNotes = [
    { note: 'C', freq: 65.41 },   // C2 base
    { note: 'D', freq: 73.42 },   // D2 base
    { note: 'E', freq: 82.41 },   // E2 base
    { note: 'F', freq: 87.31 },   // F2 base
    { note: 'G', freq: 98.00 },   // G2 base
    { note: 'A', freq: 110.00 },  // A2 base
    { note: 'B', freq: 123.47 },  // B2 base
    { note: 'C', freq: 130.81 },  // C3 base
    { note: 'D', freq: 146.83 },  // D3 base
    { note: 'E', freq: 164.81 },  // E3 base
    { note: 'F', freq: 174.61 },  // F3 base
    { note: 'G', freq: 196.00 },  // G3 base
    { note: 'A', freq: 220.00 },  // A3 base
    { note: 'B', freq: 246.94 },  // B3 base
    { note: 'C', freq: 261.63 },  // C4 base
    { note: 'D', freq: 293.66 }   // D4 base
  ];
  
  // Generate pads based on selected preset
  useEffect(() => {
    const preset = padPresets[selectedPreset];
    const octaveMultiplier = Math.pow(2, preset.octave - 2); // Calculate octave shift
    
    const padConfigs = baseNotes.map((baseNote, index) => ({
      id: index,
      note: `${baseNote.note}${preset.octave}`,
      freq: baseNote.freq * octaveMultiplier,
      color: preset.color,
      preset: selectedPreset
    }));
    
    setPads(padConfigs);
  }, [selectedPreset]);

  // Handle pad trigger
  const triggerPad = (pad, velocity = 0.7) => {
    if (!audioContext || !masterGain) return;

    // Visual feedback
    setActivePads(prev => new Set(prev).add(pad.id));
    setTimeout(() => {
      setActivePads(prev => {
        const next = new Set(prev);
        next.delete(pad.id);
        return next;
      });
    }, 300);

    // Get current preset configuration
    const preset = padPresets[selectedPreset];
    const now = audioContext.currentTime;
    
    // Create audio chain with reverb, delay, and slow filtering
    const osc = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const slowFilter = audioContext.createBiquadFilter();
    const convolver = audioContext.createConvolver();
    const reverbGain = audioContext.createGain();
    const delayNode = audioContext.createDelay(0.5);
    const delayFeedback = audioContext.createGain();
    const delayWet = audioContext.createGain();
    const dryGain = audioContext.createGain();
    
    // Configure oscillator based on preset with portamento
    osc.type = preset.oscillatorType;
    
    // Apply portamento/glide for punchy leads
    if (preset.portamento && lastFrequencyRef.current) {
      osc.frequency.setValueAtTime(lastFrequencyRef.current, now);
      osc.frequency.exponentialRampToValueAtTime(pad.freq, now + preset.portamento);
    } else {
      osc.frequency.setValueAtTime(pad.freq, now);
    }
    
    // Store frequency for next portamento
    lastFrequencyRef.current = pad.freq;
    
    // Configure main filter based on preset
    filter.type = preset.filterType;
    filter.frequency.setValueAtTime(preset.filterFreq + (velocity * 2000), now);
    filter.Q.setValueAtTime(3, now);
    
    // Configure slow sweep filter
    slowFilter.type = 'lowpass';
    slowFilter.frequency.setValueAtTime(preset.filterFreq * 0.5, now);
    slowFilter.frequency.linearRampToValueAtTime(preset.filterFreq * 2, now + 2.0); // 2-second sweep
    slowFilter.Q.setValueAtTime(1.5, now);
    
    // Create reverb impulse response (enhanced for punchy leads)
    const reverbSize = preset.reverb ? preset.reverb.roomSize || 0.5 : 0.5;
    const impulseLength = audioContext.sampleRate * (2 + reverbSize); // Variable length
    const impulse = audioContext.createBuffer(2, impulseLength, audioContext.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < impulseLength; i++) {
        const decay = Math.pow(1 - i / impulseLength, reverbSize + 1);
        channelData[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    convolver.buffer = impulse;
    
    // Configure delay effects (for punchy leads)
    if (preset.delay) {
      delayNode.delayTime.setValueAtTime(preset.delay.time, now);
      delayFeedback.gain.setValueAtTime(preset.delay.feedback, now);
      delayWet.gain.setValueAtTime(preset.delay.wet, now);
    } else {
      delayNode.delayTime.setValueAtTime(0, now);
      delayFeedback.gain.setValueAtTime(0, now);
      delayWet.gain.setValueAtTime(0, now);
    }
    
    // Configure reverb mix (enhanced for punchy leads)
    const reverbAmount = preset.reverb ? preset.reverb.wet || 0.3 : 0.3;
    reverbGain.gain.setValueAtTime(reverbAmount, now);
    dryGain.gain.setValueAtTime(1 - reverbAmount, now);
    
    // Configure envelope based on preset (ADSR)
    const env = preset.envelope;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(velocity * 0.6, now + env.attack);
    envelope.gain.exponentialRampToValueAtTime(velocity * env.sustain, now + env.attack + env.decay);
    envelope.gain.exponentialRampToValueAtTime(0.01, now + env.attack + env.decay + env.release);
    
    // Connect audio chain with delay, reverb, and filtering
    osc.connect(filter);
    filter.connect(slowFilter);
    
    // Split to dry, delay, and reverb paths
    slowFilter.connect(dryGain);
    
    // Delay chain (for punchy leads)
    if (preset.delay) {
      slowFilter.connect(delayNode);
      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode); // Feedback loop
      delayNode.connect(delayWet);
    }
    
    // Reverb path
    slowFilter.connect(convolver);
    convolver.connect(reverbGain);
    
    // Mix all paths through envelope
    dryGain.connect(envelope);
    reverbGain.connect(envelope);
    if (preset.delay) {
      delayWet.connect(envelope);
    }
    envelope.connect(masterGain);
    
    // Start and schedule stop
    osc.start(now);
    osc.stop(now + env.attack + env.decay + env.release);
    
    // Store reference for cleanup
    oscillatorsRef.current[pad.id] = osc;
    
    // Clean up after sound ends
    setTimeout(() => {
      delete oscillatorsRef.current[pad.id];
    }, (env.attack + env.decay + env.release) * 1000 + 100);
    
    // Notify other users via socket
    if (socket && sessionCode) {
      socket.emit('pad-trigger', { sessionCode, padId: pad.id, velocity, preset: selectedPreset });
    }
    
    // Callback for parent component
    if (onPadTrigger) {
      onPadTrigger(pad, velocity);
    }
  };

  // Handle mouse/touch events
  const handlePadPress = (pad, event) => {
    event.preventDefault();
    
    // Calculate velocity based on click position
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const velocity = 1 - (y / rect.height); // Top = high velocity, bottom = low
    
    triggerPad(pad, Math.max(0.2, Math.min(1, velocity)));
  };

  // Handle keyboard triggers (for desktop)
  useEffect(() => {
    const keyMap = {
      '1': 0, '2': 1, '3': 2, '4': 3,
      'q': 4, 'w': 5, 'e': 6, 'r': 7,
      'a': 8, 's': 9, 'd': 10, 'f': 11,
      'z': 12, 'x': 13, 'c': 14, 'v': 15
    };

    const handleKeyDown = (e) => {
      const padId = keyMap[e.key.toLowerCase()];
      if (padId !== undefined && pads[padId]) {
        triggerPad(pads[padId], 0.8);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pads, audioContext, masterGain]);

  // Listen for remote pad triggers
  useEffect(() => {
    if (socket) {
      const handleRemotePad = ({ padId, velocity, preset }) => {
        if (pads[padId]) {
          // Temporarily switch to remote user's preset for this trigger
          const originalPreset = selectedPreset;
          if (preset && preset !== selectedPreset) {
            setSelectedPreset(preset);
            setTimeout(() => setSelectedPreset(originalPreset), 100);
          }
          triggerPad(pads[padId], velocity);
        }
      };
      
      socket.on('pad-trigger', handleRemotePad);
      return () => socket.off('pad-trigger', handleRemotePad);
    }
  }, [socket, pads, selectedPreset]);

  return (
    <div style={{
      padding: '20px',
      maxWidth: '600px',
      margin: '0 auto',
      userSelect: 'none'
    }}>
      {/* Preset Selector */}
      <div style={{
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        <h3 style={{
          fontSize: '16px',
          marginBottom: '15px',
          color: '#2a2a2a',
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.05em'
        }}>
          PAD PRESETS
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
          marginBottom: '20px'
        }}>
          {Object.entries(padPresets).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => setSelectedPreset(key)}
              style={{
                padding: '8px 6px',
                border: `2px solid ${selectedPreset === key ? preset.color : '#e0e0e0'}`,
                borderRadius: '0px',
                background: selectedPreset === key ? '#fafafa' : '#ffffff',
                color: '#2a2a2a',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.05em',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ fontWeight: '600', marginBottom: '2px' }}>
                {preset.name.toUpperCase()}
              </div>
              <div style={{ opacity: 0.6, fontSize: '8px' }}>
                {preset.oscillatorType} • {preset.octave}
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {/* Pad Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px'
      }}>
      {pads.map((pad) => (
        <button
          key={pad.id}
          onMouseDown={(e) => handlePadPress(pad, e)}
          onTouchStart={(e) => handlePadPress(pad, e.touches[0])}
          style={{
            aspectRatio: '1',
            border: `2px solid ${activePads.has(pad.id) ? pad.color : '#e0e0e0'}`,
            borderRadius: '0px',
            background: activePads.has(pad.id) 
              ? `${pad.color}22` 
              : '#ffffff',
            boxShadow: activePads.has(pad.id)
              ? `0 0 15px ${pad.color}66`
              : 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2a2a2a',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.1s ease',
            transform: activePads.has(pad.id) ? 'scale(0.95)' : 'scale(1)',
            outline: 'none',
            fontFamily: '"Space Mono", monospace'
          }}
        >
          <div>{pad.note}</div>
          <div style={{ fontSize: '9px', opacity: 0.6, marginTop: '2px' }}>
            {pad.id < 4 ? (pad.id + 1) : 
             pad.id < 8 ? ['Q','W','E','R'][pad.id - 4] :
             pad.id < 12 ? ['A','S','D','F'][pad.id - 8] :
             ['Z','X','C','V'][pad.id - 12]}
          </div>
        </button>
      ))}
      </div>
      
      <div style={{
        marginTop: '15px',
        textAlign: 'center',
        fontSize: '10px',
        opacity: 0.6,
        color: '#666',
        fontFamily: '"Space Mono", monospace',
        letterSpacing: '0.05em'
      }}>
        Click pads or use keyboard (1-4, Q-R, A-F, Z-V)
      </div>
    </div>
  );
};

export default PadController;