import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Settings2, 
  Mic2, 
  Activity, 
  Layers, 
  Compass, 
  Volume2,
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';
import { generateVerse, VerseConfig, Density, Orbit, Grid } from './services/geminiService';
import { parseBars } from './lib/bars';

const Tooltip = ({ children, text }: { children: React.ReactNode; text: string; key?: React.Key }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block w-full" onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gallery-white text-brutal-black text-[10px] font-bold uppercase tracking-tighter brutal-shadow-pink pointer-events-none whitespace-normal w-48 text-center"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gallery-white" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TOOLTIPS = {
  DENSITY: {
    LOW: "End rhymes drive structure. Prioritize clarity and storytelling.",
    MID: "End rhymes mandatory. At least one internal rhyme per couplet.",
    HIGH: "Internal rhyme in every line. Multi-syllable chains. Technical focus."
  },
  ORBIT: {
    TIGHT: "Stay literal. One-hop metaphors. Direct connection to phrase.",
    MID: "Two-hop associations. Abstract ideas allowed if logically connected.",
    LOOSE: "Full stream of consciousness. Maximum drift from original phrase."
  },
  GRID: {
    POCKET: "Behind the beat. Conversational delivery. Longer phrases.",
    MID: "On the beat. Standard hip-hop pacing. Balanced cadence.",
    CHOPPER: "Rapid-fire. Staccato bursts. Percussive consonants. Max speed."
  }
};

export default function App() {
  const [seed, setSeed] = useState('');
  const [density, setDensity] = useState<Density>('MID');
  const [orbit, setOrbit] = useState<Orbit>('MID');
  const [grid, setGrid] = useState<Grid>('MID');
  const [tone, setTone] = useState('');
  const [isSpitting, setIsSpitting] = useState(false);
  const [verse, setVerse] = useState('');
  const [copied, setCopied] = useState(false);
  
  const outputRef = useRef<HTMLDivElement>(null);

  const handleSpit = async () => {
    if (!seed.trim() || isSpitting) return;
    
    setIsSpitting(true);
    setVerse('');
    
    try {
      const config: VerseConfig = { seed, density, orbit, grid, tone };
      const stream = generateVerse(config);
      
      for await (const chunk of stream) {
        setVerse(prev => prev + chunk);
      }
    } catch (error) {
      console.error('Error generating verse:', error);
      setVerse('ERROR: ENGINE STALLED. CHECK CONNECTION OR API KEY.');
    } finally {
      setIsSpitting(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(verse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [verse]);

  return (
    <div className="min-h-screen bg-brutal-black text-gallery-white flex flex-col font-mono selection:bg-neon-green selection:text-brutal-black">
      {/* Marquee Header */}
      <div className="h-12 border-b-2 border-gallery-white overflow-hidden flex items-center bg-neon-pink text-brutal-black">
        <div className="marquee-track whitespace-nowrap font-display text-2xl uppercase tracking-widest">
          {[...Array(10)].map((_, i) => (
            <span key={i} className="mx-8">
              FlowState // Technical Freestyle Engine // Gemini 3.1 Pro // Rhythmic Intelligence //
            </span>
          ))}
        </div>
      </div>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[400px_1fr] overflow-hidden">
        {/* Control Panel */}
        <aside className="border-r-2 border-gallery-white p-6 flex flex-col gap-8 overflow-y-auto bg-zinc-900/50">
          <section>
            <div className="flex items-center gap-2 mb-4 text-neon-pink">
              <Zap size={20} />
              <h2 className="font-display text-xl uppercase tracking-tight">Input Phrase</h2>
            </div>
            <div className="relative">
              <input 
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="ENTER PHRASE..."
                className="w-full bg-brutal-black brutal-border p-4 text-lg focus:outline-none focus:ring-2 focus:ring-neon-pink brutal-shadow-pink transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleSpit()}
              />
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-2 mb-2 text-neon-pink opacity-70">
              <Settings2 size={18} />
              <h2 className="text-xs uppercase font-bold tracking-widest">Architecture</h2>
            </div>

            {/* Density */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                <Layers size={12} /> Density (Rhyme Complexity)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['LOW', 'MID', 'HIGH'] as Density[]).map((d) => (
                  <Tooltip key={d} text={TOOLTIPS.DENSITY[d]}>
                    <button
                      onClick={() => setDensity(d)}
                      className={`w-full text-xs py-2 brutal-border transition-all ${
                        density === d ? 'bg-gallery-white text-brutal-black' : 'hover:bg-white/10'
                      }`}
                    >
                      {d}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Orbit */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                <Compass size={12} /> Orbit (Conceptual Distance)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['TIGHT', 'MID', 'LOOSE'] as Orbit[]).map((o) => (
                  <Tooltip key={o} text={TOOLTIPS.ORBIT[o]}>
                    <button
                      onClick={() => setOrbit(o)}
                      className={`w-full text-xs py-2 brutal-border transition-all ${
                        orbit === o ? 'bg-gallery-white text-brutal-black' : 'hover:bg-white/10'
                      }`}
                    >
                      {o}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Grid */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                <Activity size={12} /> Grid (Flow & Cadence)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['POCKET', 'MID', 'CHOPPER'] as Grid[]).map((g) => (
                  <Tooltip key={g} text={TOOLTIPS.GRID[g]}>
                    <button
                      onClick={() => setGrid(g)}
                      className={`w-full text-xs py-2 brutal-border transition-all ${
                        grid === g ? 'bg-gallery-white text-brutal-black' : 'hover:bg-white/10'
                      }`}
                    >
                      {g}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                <Volume2 size={12} /> Tone (Optional)
              </label>
              <input 
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="AGGRESSIVE, MELANCHOLIC..."
                className="w-full bg-brutal-black border border-white/20 p-2 text-xs focus:outline-none focus:border-neon-green"
              />
            </div>
          </section>

          <div className="mt-auto pt-6">
            <button
              onClick={handleSpit}
              disabled={isSpitting || !seed.trim()}
              className={`w-full py-4 font-display text-2xl uppercase tracking-widest flex items-center justify-center gap-3 transition-all brutal-shadow-neon ${
                isSpitting || !seed.trim() 
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50' 
                  : 'bg-neon-green text-brutal-black hover:translate-x-[-2px] hover:translate-y-[-2px] active:translate-x-0 active:translate-y-0 active:shadow-none'
              }`}
            >
              {isSpitting ? (
                <>
                  <RefreshCw className="animate-spin" size={24} />
                  Igniting...
                </>
              ) : (
                <>
                  <Mic2 size={24} />
                  Spit Bars
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Output Area */}
        <section className="relative flex flex-col overflow-hidden bg-black">
          {/* Status Bar */}
          <div className="h-10 border-b border-white/10 px-6 flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-500">
            <div className="flex gap-4">
              <span>Status: {isSpitting ? 'Generating' : 'Idle'}</span>
              <span>Engine: Gemini 3.1 Pro</span>
              <span>Phrase: {seed || 'None'}</span>
            </div>
            {verse && (
              <button 
                onClick={copyToClipboard}
                className="flex items-center gap-1 hover:text-neon-green transition-colors"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy Verse'}
              </button>
            )}
          </div>

          {/* Verse Display */}
          <div 
            ref={outputRef}
            className="flex-1 overflow-y-auto p-8 lg:p-12 space-y-4 font-mono text-lg lg:text-2xl leading-relaxed"
          >
            <AnimatePresence mode="popLayout">
              {!verse && !isSpitting && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.3 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-4"
                >
                  <div className="w-24 h-24 brutal-border rounded-full flex items-center justify-center animate-pulse">
                    <Mic2 size={40} />
                  </div>
                  <p className="max-w-xs uppercase text-sm tracking-tighter">
                    Engine primed. Input a phrase to generate a technical freestyle verse.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {parseBars(verse).map((bar, idx) => {
              return (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bar-line group"
                >
                  <span className="text-zinc-700 mr-4 text-xs w-6">{String(idx + 1).padStart(2, '0')}</span>
                  <div className="flex flex-wrap items-center">
                    {bar.map((segment, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="caesura">//</span>}
                        <span className="group-hover:text-neon-green transition-colors">{segment}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </motion.div>
              );
            })}
            
            {isSpitting && (
              <motion.div 
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-2 h-8 bg-neon-pink ml-10 mt-4"
              />
            )}
          </div>

          {/* Background Visualizer (Faked with CSS) */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03] overflow-hidden">
            <div className="absolute inset-0 grid grid-cols-12 gap-4">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="h-full border-r border-white" />
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer Info */}
      <footer className="h-8 border-t-2 border-gallery-white px-4 flex items-center justify-between text-[9px] uppercase tracking-widest bg-zinc-900">
        <div className="flex gap-4">
          <span>© 2026 FlowState Labs</span>
          <span>Build v1.0.4-alpha</span>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex gap-1">
            <div className="w-1 h-1 bg-neon-green rounded-full animate-ping" />
            <span>System Online</span>
          </div>
          <span className="text-zinc-600">Lat: 37.7749° N, Lon: 122.4194° W</span>
        </div>
      </footer>
    </div>
  );
}
