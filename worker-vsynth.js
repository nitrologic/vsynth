// worker-vsynth.js
// (C)2025 Simon Armstrong
// All rights reserved

// hold issues with touch interface
// 0xBn 0x7A all notes off incoming
// filters and clocks per voice

// based on nitrologic synth vicious
// https://github.com/nitrologic/m2

"use strict"

// settings for filters are echoed to all voices via split type

let synthLog=[];
function log(line,emit=false){
	if(emit) synthLog.push(line);
	if(synthLog.length>50){
		synthLog=synthLog.slice(25);
		log("synthlog Sliced");
	}
}

function Snapshot(o,snap,depth){
	let entries=Object.entries(o);
	let n=entries.length;
	for(let i=0;i<n;i++){
		let name=entries[i][0];
		// hide _ members from snapshots
		let index=name.indexOf('_');
		if(index==-1){
			let value=entries[i][1];
			if(value && typeof value === 'object'){
				if(depth>0){
					let isArray=value instanceof Array||ArrayBuffer.isView(value);
					let values=isArray?[]:{};
					Snapshot(value,values,depth-1);
					snap[name]=values;
				}
			}else{
				snap[name]=value;
			}
		}
	}
}

class VSynthAudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.osc=0.0;
		this.reads=0;
		this.writes=0;
		this.outs=0;
		this.count=0;
		var vicious=new VSynth(this);
		this.vsynth=vicious;
		this.port.onmessage=(message) => {
			this.vsynth.onCommands(message.data);
		};
		this.reset();
	}

	reset(){
//		this.port.postMessage({name:"snapshot"});
//		var name="vcontrol";
//		let controls=this.vsynth.controlNames;		
//		this.port.postMessage({name,controls,count:this.count++});
	}

	process(inputs,outputs,parameters) {
		if(inputs && inputs.length>0){
			var in0=inputs[0];
			var channels=in0.length;
			if(channels==2){
				var name="vsynth";
				var left=in0[0];
				var right=in0[1];
				var n=left.length;
				this.writes+=n;
				this.port.postMessage({name,left,right,count:this.count++});
			}
		}
		if(outputs && outputs.length>0 && parameters.beep || true){
			var out0=outputs[0];
			var channels=out0.length;
			var left=out0[0];
			var right=out0[1];
			var osc=this.osc;
			var n=left.length;
			var float64s=this.vsynth.mixAudioBuffers(n);
			if(channels==1){
				for(var i=0;i<n;i++){
					left[i]=float64s[i*2];
				}
			}
			if(channels==2){
				for(var i=0;i<n;i++){
					left[i]=float64s[i*2];
					right[i]=float64s[i*2+1];
				}
			}
			this.osc=osc;
			this.outs+=n;
		}
		return true;
	}
}

registerProcessor('VSynthAudioProcessor',VSynthAudioProcessor);

const FragmentSize=128;
const MaxPolyphony=128;
const SpeedOfSound=340.29;

const AudioFrequency = 48000;
const Nyquist = AudioFrequency / 2;

const BIQUAD_LOWPASS = 0;
const BIQUAD_HIGHPASS = 1;
const BIQUAD_BANDPASS = 2;
const BIQUAD_NOTCH = 3;
const BIQUAD_ALLPASS = 4;

class BiquadNode{
	constructor(biquad){
		this.owner=biquad;
		this.reset();
	}
	reset(){
		this.z1 = 0;
		this.z2 = 0;
	}	
	filterFragment(buffer, count) {
		let biquad=this.owner;
		if(biquad.enabled){
			let z1=this.z1;
			let z2=this.z2;
			for (let i = 0; i < count; i++) {
				const input = buffer[i];
				const w = input - biquad.a1 * z1 - biquad.a2 * z2;
				const output = biquad.b0 * w + biquad.b1 * z1 + biquad.b2 * z2;
				z2 = z1;
				z1 = w;
				buffer[i] = output;
			}
			this.z1=z1;
			this.z2=z2;
		}
	}
}

class BiquadFilter {
	constructor(){
		this.enabled=false;
		this.type=BIQUAD_LOWPASS;
		this.cutoff=20;
		this.cutoff2=0;
		this.Q=0.1;
		this.Q2=0;
	}
	SetFilterParam(enabled,type,cutoff,q) {
		this.enabled=enabled;
		this.type = Math.max(0, Math.min(type, 4));
		this.cutoff=cutoff;
		this.Q = q;
		this.updateCoefficients();
	}
	updateCoefficients() {
		let cutoff = Math.max(20, Math.min(Nyquist, this.cutoff+this.cutoff2));
		let Q = Math.max(0.1, Math.min(50, this.Q+this.Q2));
		const w0 = 2 * Math.PI * cutoff / AudioFrequency;
		const cosW0 = Math.cos(w0);
		const sinW0 = Math.sin(w0);
		const alpha = sinW0 / (2 * Q);
		const a0 = 1 + alpha;
		// TODO: consider if (a0>0) guard
		switch (this.type) {
			case BIQUAD_LOWPASS: this.b0 = (1 - cosW0) / 2 / a0; this.b1 = (1 - cosW0) / a0; this.b2 = (1 - cosW0) / 2 / a0; break;
			case BIQUAD_HIGHPASS: this.b0 = (1 + cosW0) / 2 / a0; this.b1 = -(1 + cosW0) / a0; this.b2 = (1 + cosW0) / 2 / a0; break;
			case BIQUAD_BANDPASS: this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0; break;
			case BIQUAD_NOTCH: this.b0 = 1 / a0; this.b1 = (-2 * cosW0) / a0; this.b2 = 1 / a0; break;
			case BIQUAD_ALLPASS: this.b0 = (1 - alpha) / a0; this.b1 = (-2 * cosW0) / a0; this.b2 = (1 + alpha) / a0; break;
		}
		this.a1 = (-2 * cosW0) / a0;
		this.a2 = (1 - alpha) / a0;
	}
}

class Tone{
	constructor(note,velocity){
		this.note=note;
		this.velocity=velocity;
	}
}

class Envelope{
	constructor(){
		this.t=0;
		this.value=0;
		this.noteOn=false;
	}
	On(){
		return 1.0;
	}
	Off(){
		return 0.0;
	}
}

class ADSR extends Envelope{

	constructor(a,d,s,r){
		super();
		this.attack=a;
		this.decay=d;
		this.sustain=s;
		this.release=r;
	}
	On(){
		if (!this.noteOn){
			this.t=0;
			this.noteOn=true;
		}
		this.t += 1.0/AudioFrequency;
		let v=this.sustain;
		if (this.t < this.attack){
			v=this.t/this.attack;
		}else if (this.t - this.attack < this.decay){
			v=1.0 - ((1-this.sustain)*(this.t-this.attack)/this.decay);
		}
		this.value=v;
		return v;
	}
	Off(){
		if (this.noteOn){
			this.t=0;
			this.noteOn=false;
		}
		this.t += 1.0/AudioFrequency;
		if (this.t < this.release){
			return this.value*(1.0-this.t/this.release);
		}
		return 0.0;
	}
}

class Oscillator
{
	constructor(){
		this.delta=0;
	}
	Sample(hz){
		return 0;
	}
}

class Sine extends Oscillator{
	Sample(hz){
		let t=hz/AudioFrequency;
		this.delta=(this.delta+t)%1;
		let s=Math.sin(2*Math.PI*this.delta);
		return s;
	}
}	

class Sawtooth extends Oscillator{
	Sample(hz){
		let t=hz/AudioFrequency;
		this.delta=(this.delta+t)%1;
		return ((2*this.delta+1) % 2) - 1;
	}
}

class Triangle extends Oscillator{
	Sample(hz){
		let t=hz/AudioFrequency;
		this.delta=(this.delta+t)%1;
		let v=this.delta;
		return 4*Math.abs(((v+0.75)%1)-0.5)-1;
	}
}	

class Square extends Oscillator{
	Sample(hz){
		let t=hz/AudioFrequency;
		this.delta=(this.delta+t)%1;
		return -1 + 2*(Math.floor(this.delta*2) & 1);
	}
}	

class Noise extends Oscillator{
	constructor(){
		super();
		this.a=0;
	}
	Sample(hz){
		let t=hz/AudioFrequency;
		let delta0=this.delta;
		this.delta += t;
		let f=this.delta % 1;
		if (Math.floor(delta0) != Math.floor(this.delta)){
			this.a=Math.random();
		}
		return 1 - 2*this.a;
	}
}	

class Rompler extends Oscillator{
	constructor(){
		super();
		this.a=0;
	}
	Sample(hz){
		let t=hz/AudioFrequency;
		let delta0=this.delta;
		this.delta += t;
		let f=this.delta % 1;
		if (Math.floor(delta0) != Math.floor(this.delta)){
			this.a=Math.random();
		}
		return 1 - 2*this.a;
	}
}	

class NotePlayer{
	constructor(){
	}
	// 4 noise
	SetOscillator(osc){
	}
	SetEnvelope(env){
	}
	SetPower(pow){		
	}
	SetGain(value){
	}
	Stop(){
	}
	NoteOn(note,velocity){
	}
	NoteOff(note){
	}
}

class Amp{
	constructor(id){
		this.lfo=null;
		this.id=id;
		this.factor2=1.0;
		this.phase=0;
	}
	SetParam(target,index,factor){
		this.target=target;
		this.index=index;
		this.factor=factor;
	}
}

class LFO{
	// amps are array of channel,gain pairs where gain is factor of signal at audio rate 
	constructor(){
		this.amps=[];
		this.phase=0.0;
	}
	AddAmp(amp){
		this.amps.push(amp);
	}
	DropAmp(amp){
		let index=this.amps.indexOf(amp);
		this.amps.splice(index,1);
	}
	SetLFOParam(osc,pow,freq,sync,gain){
		this.oscillator=osc;	
		this.power=pow;
		this.frequency=freq;
		this.gain=gain;
		this.sync=sync;
		this.fade=1.0;
		this.rate=1.0;
	}
	Step(quantum){
		let lfo=this;
		let hz=lfo.frequency*lfo.rate;
		let t=hz/AudioFrequency;
		this.phase=(this.phase+quantum*t)%1;
	}
	Sample(offset,phase){
		let lfo=this;
		let hz=lfo.frequency*lfo.rate;
		let t=hz/AudioFrequency;
		let v=Math.sin(2*Math.PI*(this.phase+offset*t-phase));
		let pow=lfo.power;
		if(pow>1) v=Math.pow(v,pow);
		if(pow<1) v=Math.sign(v)*Math.pow(Math.abs(v),pow);
		return v*lfo.fade*this.gain;
	}
}

// system lfo 

let VoiceCount=0;

const temp=new Float64Array(FragmentSize)

class Voice extends NotePlayer{
	constructor(){
		super();
		this.id=++VoiceCount;
		this.noteOn=false;
		this.hz=0;
		this.gain=0.8;
		this.amp=0;
		this.filters=[]; // BiquadNode z0,z1
		this.triggers=[];
	}
	addFilter(biquad){
		this.filters.push(new BiquadNode(biquad));
	}
	SetOscillator(osc){
		this.oscillator=osc;
		switch(osc){
			case 0:
				this.waveform=new Noise();
				break;
			case 1:
				this.waveform=new Sine();
				break;
			case 2:
				this.waveform=new Square();
				break;
			case 3:
				this.waveform=new Triangle();
				break;
			case 4:
				this.waveform=new Sawtooth();
				break;
			case 5:
				this.waveform=new Rompler();
				break;
		}
	}
	SetEnvelope(env){
		switch(env){
			case 0:
				this.envelope=new Envelope();
				break;
			case 1:
				this.envelope=new ADSR(0.001,1.5,0.2,0.5);
				break;
			case 2:
				this.envelope=new ADSR(0.06,0.01,0.92,0.2);
				break;
			case 3:
				this.envelope=new ADSR(0.06,2.0,0.2,1.2);
				break;
			case 4:
				this.envelope=new ADSR(0.2,0.2,0.92,0.4);
				break;
		}
	}
	SetPower(pow){		
		this.power=pow;
	}
	SetGain(value){
		this.gain=value;
	}
	Stop(){
		this.noteOn=false;
		this.envelope.Off();
	}
	NoteOn(note,velocity){
		// tuned to Middle C 262
		this.hz=262.0*Math.pow(2.0,(note-60.0)/12);
		this.amp=velocity/100.0;
		this.noteOn=true;
	}
	NoteOff(note){
		this.Stop();
	}
	MixDown(buffer,samples,rate,fade,pan){
		let silent=true;
		let left=1.0;
		let right=1.0;
		if (pan < 0){
			right += pan;
		}
		if (pan > 0){
			left -= pan;
		}
		let pow=this.power;
		for (let i=0;i < samples;i++){
			let hz=this.hz*rate[i];
			let v=this.waveform.Sample(hz);
			if(pow>1) v=Math.pow(v,pow);
			if(pow<1) v=Math.sign(v)*Math.pow(Math.abs(v),pow);
			let e=0;
			if (this.noteOn){
				e=this.envelope.On();
			}else{
				e=this.envelope.Off();
			}
			if (e != 0){
				e*=this.gain;
				e*=this.amp;
				e*=fade[i];
				temp[i]=e*v;
				silent=false;
			}else{
				temp[i]=0;
			}
		}
		if(!silent){
			for(let filter of this.filters){
				filter.filterFragment(temp,samples);
			}
			for (let i=0;i < samples;i++){
				let v=temp[i];
				buffer[i*2+0]+=v*left;
				buffer[i*2+1]+=v*right;
			}
		}
	}
}

class Synth{
	constructor(){
		this.keys=new Keys();
	}
	SetTempo(tempo){
	}
	SetBeat(div,duty,reps){
	}
	SetTimbre(osc,env,pow){
	}
	SetVolume(volume){
	}
	NoteOn(note,velocity){
	}
	NoteOff(note){
	}
	SetSustain(sustain){//footpedal key
	}
	SetHold(hold){//arpegiator key
	}
	FillAudioBuffer(buffer,samples,detune,fade,pan){
	}
	Panic(){
	}
	GetKeys(){
	}
}

class Outboard extends Synth{
	constructor(owner){
		super();
		this.owner=owner;
	}
	Post(commands){
		let port=this.owner.worklet.port;
		let js=JSON.stringify(commands);
		log("Outboard post midv commands : "+js)
		port.postMessage({name:"midv",commands});
	}
	SetVolume(vol){
		this.volume=vol;
	}
	SetSustain(sustain){
	}
	GetKeys(){
		return this.keys;
	}
	Panic(){
	}
	SetTimbre(osc,env,pow){
	}
	NoteOn(note,velocity){
		this.Post([{command:"noteon", note, velocity}]);
	}
	NoteOff(note){
		this.Post([{command:"noteoff", note}]);
	}
	FillAudioBuffer(buffer,samples,detune,fade,pan){
	}
}

class Effect{
	ControlNames(){
		return [];
	}
	EffectAudio(samples,sampleCount,control){
	}
}

class NamedEffect{
	constructor(name,effect){
		this.name=name;
		this.effect=effect;
	}
}

class Chain extends Effect{
	constructor(){
		super();
		this.chain=[];
		this.values=[];
	}
	// attendance roll call
	ControlNames(){
		let names=[];
		for (let link of this.chain){
			let name=link.name;
			let effect=link.effect;
			for (let control of effect.ControlNames()){
				names.push(name+"_"+control);
			}
		}
		return names;
	}
	AddEffect(effect,name){
		this.chain.push(new NamedEffect(name,effect));
	}
	EffectAudio(samples,sampleCount,control){		
		let cursor=0;
		for (let link of this.chain){
			let count=link.effect.ControlNames().length;
			let controls=control.slice(cursor,cursor+count);
			cursor += count;
			link.effect.EffectAudio(samples,sampleCount,controls);
		}
		this.values=control;
	}
}

class Distortion extends Effect{
	ControlNames(){
		return ["overdrive","gain"];
	}
	EffectAudio(samples,sampleCount,control){
		let overdrive=control[0];
		let gain=control[1];
		for (let s=0;s < sampleCount*2;s++){
			let i=s>>1;
			let v=samples[s];
			v *= overdrive[i];
			if (v > 0){
				v=1-Math.exp(-v);
			}else{
				v=-1+Math.exp(v);
			}
			v *= gain[i];
			samples[s]=v;
		}
	}
}

class Reverb extends Effect {
    constructor() {
        super();
        this.poles = [
            { distance: 1.0, dampen: 0.5 },
            { distance: 2.0, dampen: 0.4 },
            { distance: 5.0, dampen: 0.3 }
        ];
        const maxDistance = Math.max(...this.poles.map(p => p.distance));
        this.future = new Float64Array(Math.floor(AudioFrequency * maxDistance / SpeedOfSound) * 2);
        this.writePos = 0;
        this.removeSource = true;
    }
    ControlNames() {
        return ["wet", "dry", "effect"];
    }
    EffectAudio(samples, sampleCount, control) {
        const wet = control[0];
        const dry = control[1];
        const falloff = control[2];
        const n = sampleCount * 2;
        const futureLen = this.future.length;

        for (const pole of this.poles) {
            const offset = Math.floor(AudioFrequency * pole.distance / SpeedOfSound) * 2;
            const dampen = pole.dampen;
            for (let i = 0; i < n; i += 2) {
                const pastIdx = (this.writePos + i - offset + futureLen) % futureLen;
                const f = falloff[i / 2];
                samples[i] += this.future[pastIdx] * f;
                samples[i + 1] += this.future[pastIdx + 1] * f;
                const futureIdx = (this.writePos + i) % futureLen;
                this.future[futureIdx] = samples[i] * dampen;
                this.future[futureIdx + 1] = samples[i + 1] * dampen;
            }
        }
        for (let i = 0; i < n; i += 2) {
            const futureIdx = (this.writePos + i) % futureLen;
            const w = wet[i / 2];
            const d = dry[i / 2];
            samples[i] = w * this.future[futureIdx] + d * samples[i];
            samples[i + 1] = w * this.future[futureIdx + 1] + d * samples[i + 1];
        }
        this.writePos = (this.writePos + n) % futureLen;
    }
}
class Reverb2 extends Effect {
	constructor() {
			super();
			this.poles = [{ distance: 1.0, dampen: 0.5 }, { distance: 2.0, dampen: 0.4 }, { distance: 5.0, dampen: 0.3 }];
			const maxDistance = Math.max(...this.poles.map(p => p.distance));
			const maxOffset = Math.floor(48000 * maxDistance / 340.29) * 2;  // Using 48000 Hz explicitly
			this.future = new Float64Array(maxOffset);
			this.writePos = 0;
			this.removeSource = true;
	}
	ControlNames() {
			return ["wet", "dry", "effect"];
	}
	EffectAudio(samples, sampleCount, control) {
		let wet=control[0];
		let dry=control[1];
		let falloff=control[2];
		let n = sampleCount * 2;
		let futureLen = this.future.length;
		for (let pole of this.poles) {
				let offset = Math.floor(48000 * pole.distance / 340.29) * 2;  // Explicit AudioFrequency
				let dampen = pole.dampen;
				for (let i = 0; i < n; i += 2) {
						let pastIdx = (this.writePos + i - offset + futureLen) % futureLen;
						samples[i] += this.future[pastIdx] * falloff[i/2];
						samples[i + 1] += this.future[pastIdx + 1] * falloff[i/2];
						let futureIdx = (this.writePos + i) % futureLen;
						this.future[futureIdx] = samples[i] * dampen;
						this.future[futureIdx + 1] = samples[i + 1] * dampen;
				}
		}
		for (let i = 0; i < n; i += 2) {
				samples[i] = wet[i/2] * this.future[(this.writePos + i) % futureLen] + dry[i/2] * samples[i];
				samples[i + 1] = wet[i/2] * this.future[(this.writePos + i + 1) % futureLen] + dry[i/2] * samples[i + 1];
		}
		this.writePos = (this.writePos + n) % futureLen;
	}
}

class Keys{
	constructor(){
		this.lowhigh=new Uint32Array(4);
	}
	ToJson(){
		return "["+this.lowhigh[0]+","+this.lowhigh[1]+this.lowhigh[2]+","+this.lowhigh[3]+"]";
	}
	FromJsonArray(){
		return "";
	}
	KeyState(index){
		let bit=1 << (index & 31);
		let word=index >> 5;
		return (this.lowhigh[word] & bit) == bit;
	}
	KeyOn(index){
		let bit=1 << (index & 31);
		let word=index >> 5;
		this.lowhigh[word] |= bit;
	}
	KeyOff(index){
		let bit=1 << (index & 31);
		let word=index >> 5;
		this.lowhigh[word] &= ~bit;
	}
}

class BeatGenerator extends Synth{
	constructor(){
		super();
		this.bpm=120;
		this.divisor=3;
		this.dutycycle=0.5;
		this.output=null;
		this.time=0;
		this.clock=0;
		this.oscillator=0;
		this.envelope=0;
		this.power=1;
		this.repeats=0;
		this.recent_tone=null;
		this.count=0;
		this.note_period=0;
		this.duty_period=0;
		this.noteDuration=[];
	}
	// called from SetTempo SetBeat and 
	SetDivisor(div){
		if(div==0)div=1;
		let denom=this.bpm*div;
		if (denom > 0){
			this.note_period=60.0/denom;
		}else{
			this.note_period=0;
		}
		this.duty_period=this.dutycycle*this.note_period;
	}
	SetTempo(bpm){
		this.bpm=bpm;
		this.SetDivisor(this.divisor);
	}
	SetBeat(div,duty,reps){
		this.divisor=div;
		this.dutycycle=duty;
		this.repeats=reps;
		this.SetDivisor(div);
	}
	SetSustain(sustain){
		this.output.SetSustain(sustain);
	}
	SetVolume(volume){
		this.output.SetVolume(volume);
	}
	SetSynth(synth){
		this.output=synth;
		this.output.SetTimbre(this.oscillator,this.envelope,this.power);
	}
	SetTimbre(osc,env,pow){
		this.oscillator=osc;
		this.envelope=env;
		this.power=pow;
		this.output.SetTimbre(this.oscillator,this.envelope,this.power);
	}
	NoteOn(note,velocity){
		this.recent_tone=new Tone(note,velocity);
		this.keys.KeyOn(note);
	}
	NoteOff(note){
		this.output.NoteOff(note);
		this.keys.KeyOff(note);
	}
	Beat(){
		let r=this.recent_tone;
		if (r){
			this.NoteOn(r.note,r.velocity);
		}
	}
	UpdateBeatGenerator(duration){
		this.time += duration;
		if (this.note_period > 0){
			while (this.clock < this.time){
				this.Beat();
				this.clock += this.note_period;
			}
			this.StepDuration(duration);
		}
	}
	StepDuration(duration){
		let remaining=[]
		for (let nd of this.noteDuration){
			nd.duration-=duration;
			if (nd.duration <= 0){
				this.output.NoteOff(nd.note);
			}else{
				remaining.push(nd);
			}
		}
		this.noteDuration=remaining;
	}
	FillAudioBuffer(buffer,samples,detune,fade,pan){
		let duration=2.0*samples/AudioFrequency;
		this.UpdateBeatGenerator(duration);
		this.output.FillAudioBuffer(buffer,samples,detune,fade,pan);
	}
	GetKeys(){
		return this.output.GetKeys();
	}
	Panic(){
		this.ReleaseAll();
		this.output.Panic();
	}
	TriggerNote(note,velocity){
		if(note<0||note>127) return;
		this.output.NoteOn(note,velocity);
		let duration=this.duty_period;
		this.noteDuration.push({note,duration});
	}
	ReleaseAll(){
		for (let nd of this.noteDuration){
			this.output.NoteOff(nd.note);
		}
		this.noteDuration=[];
	}
}

function CompareNote(a,b){
	return a.note-b.note;
}

// divisor 10 => natural.length

class Arpeggiator extends BeatGenerator{
	constructor(){
		super();
		this.note_map=new Map();
		this.natural=[];
		this._sorted=[];
		this.index=0;
		this.algorithm=0;
		this.progression=0;
		this.hold=false;
		this.noteCount=0;
		this.note=null;
		this.noteOffset=0;
		this.cycle=0;
		this.noise=0xdeadbeef;
	}

	random(){
		let f=this.noise&0x7fffff;		
		let r1=f>>3;
		let l1=f<<2;
		let x1=(r1^l1)&0x7fffffff;
		this.noise^=x1;
		let r=f/0x800000;
		return r;
	}

	UpdateBeatGenerator(duration){
		if(this.divisor==0){
			let n=this.natural.length;
			super.SetDivisor(n);
		}
		super.UpdateBeatGenerator(duration);
	}

	Panic(){
		// help super panic should call this ReleaseAll?
		this.ReleaseAll();
		super.Panic();
	}
	// orphan reset where state.notes is raw array of note,velocity pairs
	ResetState(state){
		this.ReleaseAll();
		let notes=state.natural;
		if (notes){
			for (let i=0;i<notes.length/2;i++){
				let note=notes[i*2+0];
				let velocity=notes[i*2+1];
				this.natural.push(new Tone(note,velocity));
			}
		}
		this.SortState();
		this.index=this.natural.length;
		this.noteCount=0;
	}
	SortState(){
		// make a copy and sort it
		this._sorted=this.natural.slice();
		this._sorted.sort(CompareNote);
	}

	SetArpeggiation(algo,prog){
		this.algorithm=algo;
		this.progression=prog;
		this.noteOffset=0;
	}
	ReleaseAll(){
		super.ReleaseAll();
		this.natural=[];
		this._sorted=[];
		this.noteCount=0;
		this.cycle=0;
		this.noteOffset=0;
		this.note_map.clear();
	}
	SetHold(down){
		if (this.hold && !down){
			this.ReleaseAll();
		}
		this.hold=down;
	}
	NoteUp(note){
		if (this.note_map.has(note)){
			this.note_map.delete(note);
			let i=this.natural.findIndex((element)=>element.note==note);
			log("arp NoteUp natural splice i:"+i+" for note "+note);
			this.natural.splice(i,1);
		}
	}
	NoteOn(note,velocity){
		if (this.hold && this.noteCount==0){
			this.ReleaseAll();
			log("Release All");
		}
		this.noteCount++;
		log("NoteOn noteCount : "+this.noteCount);
		if (this.algorithm == 0){
			this.output.NoteOn(note,velocity);
		}else{
			this.NoteUp(note);
			super.NoteOn(note,velocity);
			log("arp noteon note:"+note);
			let tone=new Tone(note,velocity);
			this.natural.push(tone);
			this.note_map.set(note,tone);
			this.SortState();
		}
	}
	NoteOff(note){
		if (this.noteCount > 0){
			this.noteCount--;
			log("NoteOff noteCount : "+this.noteCount);
		}
		log("noteCount "+this.noteCount);
		this.output.NoteOff(note);
		if (!this.hold){
			this.NoteUp(note);
		}
	}
	Beat(){
		if (this.natural.length == 0){
			this.noteOffset=0;
			this.index=0;
			this.ReleaseAll();
			return;
		}
		if (this.count > 0){
			this.count--;
			if (this.note){
				let note=this.note.note;
				let velocity=this.note.velocity;	
				this.TriggerNote(note,velocity);
			}
			return;
		}
		if (this.index >= this.natural.length){
			this.cycle++;
		}
		let sorted=this._sorted;
		switch(this.algorithm){
			case 1:
				this.index=this.index % this.natural.length;
				this.note=this.natural[this.index];
//				log("this.index="+this.index+" this.note="+this.note.note);
				this.index++;
				break;
			case 2:
				this.index=this.index % sorted.length;
				this.note=sorted[this.index];
				this.index++;
				break;
			case 3:
				this.index=this.index % sorted.length;
				this.note=sorted[sorted.length-this.index-1];
				this.index++;
				break;
			case 4:
				if (sorted.length > 1){
					let bounce=sorted.length-2;
					this.index=this.index % (sorted.length+bounce);
					let i=this.index;
					if (i > bounce){
						i=sorted.length+bounce-i;
					}
					this.note=sorted[i];
				}else{
					this.note=sorted[0];
				}
				this.index++;
				break;
			case 5:
				this.index=this.index % sorted.length;
				this.note=sorted[this.index];
				if (this.random() > 0.5){
					this.index++;
				}else{
					this.index--;
					if (this.index < 0){
						this.index=sorted.length-1;
					}
				}
				break;
			case 6:
				this.index=Math.floor(this.random()*sorted.length);
				this.note=sorted[this.index];
				break;
		}
		if(this.note) {
			let inc=0;
			switch(this.progression){
				case 1:
					this.cycle=this.cycle % this.natural.length;
					this.noteOffset=this.natural[this.cycle].note-this.natural[0].note;
					break;
				case 2:
					this.cycle=this.cycle % this.natural.length;
					inc=this.natural[this.cycle].note-this.natural[0].note;
					break;
				case 3:
					inc=this.cycle;
					break;
				case 4:
					inc=-this.cycle;
					break;
				case 5: // Janus Pivot
					inc = (this.cycle % 2 === 0) ? Math.floor(this.cycle / 2) : -Math.floor(this.cycle / 2);
					break;
				case 6: // Hydra Growth
					inc = this.cycle * 12;
					break;
				case 7: // Sisyphus Roll
					inc = this.cycle % 13; // Reset after 12 semitones
					break;
				case 8: // Chimera Shuffle
					inc = Math.floor(this.random() * 11) - 5; // -5 to +5
					break;
				case 9: // Phoenix Rebirth
					if (this.cycle % 13 === 12) {
						inc = 0;
						this.noteOffset = 0;
						this.count += 1; // Skip a beat
					} else {
						inc = this.cycle % 13;
					}
					break;
				case 10: // Prometheus Bound
					inc = (this.cycle % 5 === 4) ? -5 : 1;
					break;
				case 11: // Labyrinth Drift
					inc = Math.floor(this.random() * 7) - 3;
					if (this.noteOffset + inc > 12 || this.noteOffset + inc < -12) {
						this.noteOffset = 0;
						inc = 0;
					}
					break;
				case 12: // Oracle Pulse
					if (this.cycle % 4 === 3) {
						inc = 0;
						this.noteOffset = 0;
						this.count += 1;
					} else {
						inc = 3;
					}
					break;
				case 13: // Origami Fold
					inc = (this.cycle % 2 === 0) ? 6 : 1;
					break;
				case 14: // Elysian Echo
					inc = (this.cycle % 4 === 0) ? 0 : 7;
					if (this.cycle % 4 === 0) this.noteOffset = 0;
					break;
				case 15: // Chaos Weaver
					if (this.cycle % 8 === 0) {
						this.noteOffset = 0;
						inc = 0;
					} else {
						inc = Math.floor(this.random() * 9) - 4;
					}
					break;					

			}
			let note=this.note.note+this.noteOffset;
			let velocity=this.note.velocity;
			this.TriggerNote(note,velocity)
			this.noteOffset += inc;
			this.count=this.repeats;
		}
	}
}

class PolySynth extends Synth{
	constructor(){
		super();
		this.polyMap=new Map();
		this.voices=new Map();
		this.sustained=false;
		this.oscillator=0;
		this.envelope=0;
		this.volume=5.0;
		this.sustainedVoices=[];
		this._polyAll=[];
		this._polyList=[];
		for (let i=0;i < MaxPolyphony;i++){
			let tone=new Voice();
			tone.SetOscillator(0);
			tone.SetEnvelope(0);
			tone.SetPower(1);
			this._polyList.push(tone);
			this._polyAll.push(tone);
		}
	}
	addFilter(biquad){
		for(let voice of this._polyAll){
			voice.addFilter(biquad);
		}
	}
	GetKeys(){
		return this.keys;
	}
	Panic(){
		this.voices=new Map();
	}
	SetTempo(tempo){
	}
	SetBeat(div,duty,reps){
	}
	SetVolume(vol){
		this.volume=vol;
	}
	SetSustain(sustain){
		if (this.sustained && !sustain){
			for (let voice of this.sustainedVoices){
				voice.Stop();
			}
			this.sustainedVoices=[];
		}
		this.sustained=sustain;
	}
	SetTimbre(osc,env,pow){
		this.oscillator=osc;
		this.envelope=env;
		this.power=pow;
	}
	NoteOn(note,velocity){
		this.NoteOff(note);
		if (this._polyList.length == 0){
			log("PolySynth NoteOn : _polyList is empty",true);
			return;
		}
		let voice=this._polyList.shift();
		voice.SetEnvelope(this.envelope);
		voice.SetOscillator(this.oscillator);
		voice.SetPower(this.power);
		voice.NoteOn(note,velocity);
		this.polyMap.set(note,voice);
		//
		if (!this.voices.has(voice.id)){
			this.voices.set(voice.id,voice);
		}
		this.keys.KeyOn(note);
	}
	NoteOff(note){
		if(this.polyMap.has(note)){
			let voice=this.polyMap.get(note);
			if (this.sustained){
				this.sustainedVoices.push(voice);
			}else{
				voice.Stop();
			}
			this.polyMap.delete(note);
			this._polyList.push(voice);
		}
		this.keys.KeyOff(note);
	}
	FillAudioBuffer(buffer,samples,detune,gain,pan){
		for (const [id,voice] of this.voices.entries()){
			voice.MixDown(buffer,samples,detune,gain,pan);
		}
	}
}

class MonoSynth extends Synth{
	constructor(){
		super();
		this._tone=new Voice();
		this._tone.SetOscillator(0);
		this._tone.SetEnvelope(0);
		this._tone.SetPower(1);
		this.monoNote=null;
		this.notestack=[];
		this.oscillator=0;
		this.envelope=0;
		this.power=1.0;
		this.volume=1.0;
	}
	SetVolume(vol){
		this.volume=vol;
	}
	SetSustain(sustain){
	}
	GetKeys(){
		return this.keys;
	}
	Panic(){
		this._tone.NoteOff(this.monoNote.note);
	}
	SetTimbre(osc,env,pow){
		if (osc != this.oscillator){
			this.oscillator=osc;
			this._tone.SetOscillator(this.oscillator);
		}
		if (env != this.envelope){
			this.envelope=env;
			this._tone.SetEnvelope(this.envelope);
		}
		if (pow!=this.power){
			this.power=pow;
			this._tone.SetPower(this.power);
		}
	}
	addFilter(biquad){
		this._tone.addFilter(biquad);
	}

	NoteOn(note,velocity){
		var index=this.notestack.findIndex((n)=>(n.note==note));
		if(index>-1){
			this.notestack.splice(index,1);
		}
		var key=note;
		if(this.monoNote){
			this.notestack.push(this.monoNote)
		}
		this.monoNote=new Tone(note,velocity);
		this._tone.NoteOn(note,velocity);
		this.keys.KeyOn(key);
	}
	NoteOff(note){
		var index=this.notestack.findIndex((n)=>(n.note==note));
		if(index>-1){
			this.notestack.splice(index,1);
		}
		if(this.notestack.length==0){
			//investigate here
			if(this.monoNote){
				this._tone.NoteOff(this.monoNote.note);
				this.monoNote=null;
			}
		}else{
			var pop=this.notestack.pop();
			this.monoNote=null;
			this.NoteOn(pop.note,pop.velocity);
		}
	}
	FillAudioBuffer(buffer,samples,detune,fade,pan){
		this._tone.MixDown(buffer,samples,detune,fade,pan);
	}
}

class Stream{

	constructor(count){
		let n=16384;
		this.read=0;
		this.write=0;
		this.count=count;		
		this.buffer=new Float64Array(n);
		this.reorder={};
	}

	buffered(){
		return this.write-this.read;
	}

	space(){
		let a=this.buffered();
		return this.buffer.length-a;
	}

	Feed(data64,count,rate){
		if(count<this.count){	
			log("Stream Feed old count error",true);
			return;
		}
		if(count==this.count){	
			log("Stream Feed repeat count error",true);
			return;
		}
		if(count>this.count+1){
			this.reorder[count]=data64;
			return;
		}

		while(true){

			let a=this.space();
			if(a==0){
				log("Stream Feed reset",true);
				this.read=0;
				this.write=0;
				a=this.space();
			}
			let n=data64.length;
			if(n>a){ 
				log("Stream Feed overrun",true);
				n=a;
			}
			let b=this.buffer;
			let mask=b.length-1;

			let r=48000/rate;

			if(r==1.0){
				for(let i=0;i<n;i++){
					let sample=data64[i];
					b[(this.write+i)&mask]=sample;
				}
				this.write+=n;
			}else{
				let t=0;
				for(let i=0;i<n;i++){
					let sample=data64[i];
					t+=r;
					while(t>=1.0){
						b[(this.write++)&mask]=sample;
						t-=1.0;
					}
				}
			}

			data64=this.reorder[count+1];
			if(!data64) break;

			delete this.reorder[count+1];
			count++;
		}
		this.count=count;
	}

	// channels?

	Mix(buffer,samples){
		let r=this.buffered();
		let n=samples*2;
		if(this.read==0 && r<n*4){
			log("Stream Mix buffering");
			return;
		}
		if(n>r){
			log("Stream Mix underrun");
			return;
		}
		let gain=0.4;
		let b=this.buffer;
		let mask=b.length-1;
		for(let i=0;i<n;i++){
			buffer[i]+=gain*b[(this.read+i)&mask]
		}
		this.read+=n;
	}
}

class VSynth{

	emitSnapshot(){
		let mode=this.synthVicious;
		let effecting=this.effecting;
		let detune=this.detune;
		let fade=this.fade;		
		let modulate=this.modulate;
		let controlNames=this.effects.ControlNames();
		let controlValues=this.effectValues;
		let arp={};
		Snapshot(this.arp,arp,5);
		let state={
			mode,
			modulate,
			detune,
			effecting,
			fade,
			arp,
			controlNames,
			controlValues,
			synthLog
		};
		synthLog=[];
//		let js=JSON.stringify(state);
//		log("VSynth post midz status : "+js)
		let port=this.worklet.port;
		port.postMessage({name:"midz",state});
	}

	constructor(owner){
		this.worklet=owner;
		this.modulate=0;
		this.detune=0;
		this.detune0=0;
		this.fade=1.0;
		this.fade0=1.0;
		this.poly=new PolySynth();
		this.mono=new MonoSynth();
		this.arp=new Arpeggiator();
		this.outboard=new Outboard(this);
		this.buffer=new Float64Array(FragmentSize*2);
		this.rateBuffer=new Float64Array(FragmentSize);
		this.fadeBuffer=new Float64Array(FragmentSize);
		this.effectBuffers={
			overdrive:new Float64Array(FragmentSize),
			gain:new Float64Array(FragmentSize),
			wet:new Float64Array(FragmentSize),
			dry:new Float64Array(FragmentSize),
			falloff:new Float64Array(FragmentSize)
		};
		this.reset();
	}

	reset(){
		this.settings={pan:0};
		this.lfo=[];
		this.filter=[];
		this.amp={};
		this.effectValues={};
		this.effects=new Chain();
		this.effects.AddEffect(new Distortion(),"distortion");
		this.effects.AddEffect(new Reverb(),"reverb");		
		this.effecting=false;
		this.recording=false;

		this.capture = false;
		this.leftBuffer = new Float64Array(1024);  // 8 * 128
		this.rightBuffer = new Float64Array(1024); // 8 * 128
		this.bufferPosition = 0;

		this.root=this.arp;
		this.inputStreams={};
		this.SetMode(0);
		this.transpose=0;		
//		this.controlNames=this.effects.ControlNames();
//		log("names:"+this.controlNames.join(", "));
//		this.emitSnapshot();
	}

	captureAudio(samples) {
		let offset = this.bufferPosition;
		if(samples){
			this.leftBuffer.set(this.buffer.subarray(0, 128), offset);
			this.rightBuffer.set(this.buffer.subarray(128, 256), offset);
			this.bufferPosition += 128;
		}
		if (samples==0||this.bufferPosition === 1024) {
			this.worklet.port.postMessage({
				name: "vsynth",
				left: this.leftBuffer,
				right: this.rightBuffer,
				count: this.bufferPosition,
				audio: true
			}, [this.leftBuffer.buffer, this.rightBuffer.buffer]);
			this.leftBuffer = new Float64Array(1024);
			this.rightBuffer = new Float64Array(1024);
			this.bufferPosition = 0;
		}
	}

	SetCapture(on) {
		if (on==this.capture) return;
		if (on) {
			this.bufferPosition = 0;
		}else{
			this.captureAudio(0);
		}
		this.capture = on;
	}

	// line.command="pcm64";

	RawAudioIn(event){
		let command=event.command;
		let data64=event.data;
		let count=event.count;
		let rate=event.rate;
		let source=event.source;
		if(!(source in this.inputStreams)){
			this.inputStreams[source]=new Stream(count);
		}
		let stream=this.inputStreams[source];
		stream.Feed(data64,count,rate);
	}

	SetAmp(id,lfoIndex,target,index,factor)
	{
		if(!(lfoIndex in this.lfo)) return;
		if(!(id in this.amp)){
			log("adding amp id:"+id);
			let amp=new Amp(id);
			this.amp[id]=amp;
		}
		let amp=this.amp[id]
		if(amp.lfo!=lfoIndex){
			if(amp.lfo){
				let lfo=this.lfo[amp.lfo];
				this.ResetAmp(amp);
				lfo.DropAmp(amp);
			}
			let lfo=this.lfo[lfoIndex];
			lfo.AddAmp(amp);
			amp.lfo=lfoIndex;
		}
		amp.SetParam(target,index,factor);
	}

	SetLFO(index,osc,pow,freq,sync,gain)
	{
		if(!(index in this.lfo)){
			log("adding lfo");
			let lfo=new LFO();
			this.lfo[index]=lfo;
//			this.poly.addLFO(lfo);
//			this.mono.addLFO(lfo);			
		}
		let lfo=this.lfo[index];
		lfo.SetLFOParam(osc,pow,freq,sync,gain);
	}

	SetFilter(index,enabled,type,cutoff,q){
		if(!(index in this.filter)){
			log("adding filter");
			let biquad=new BiquadFilter();
			this.filter[index]=biquad;
			this.poly.addFilter(biquad);
			this.mono.addFilter(biquad);
		}
		let filter=this.filter[index];
		filter.SetFilterParam(enabled,type,cutoff,q);
	}

	SetArpeggiation(algo,prog){
		this.arp.SetArpeggiation(algo,prog);
	}

	SetTempo(tempo){
		this.arp.SetTempo(tempo);
	}

	SetBeat(div,duty,reps){
		this.arp.SetBeat(div,duty,reps);
	}

	// mono,poly,external

	SetMode(synthmode){
		this.synthVicious=synthmode;
		switch(synthmode){
			case 0:
				this.arp.SetSynth(this.mono);
				break;
			case 1:
				this.arp.SetSynth(this.poly);
				break;
			case 2:
				this.arp.SetSynth(this.outboard);
				break;
		}		
	}

	ResetAmp(amp){
		let index=amp.index;
		let factor=amp.factor*amp.factor2;
		let phase=amp.phase;
		let v=0;
		switch (amp.target){
			case 2://filter cutoff
				let filter0=this.filter[index];
				if(filter0) {
					filter0.cutoff2=0;
					filter0.updateCoefficients();
				}
				break;
			case 3://filter Q
				let filter1=this.filter[index];
				if(filter1) {
					filter1.Q2=0;
					filter1.updateCoefficients();
				}
				break;
			case 4://lfo fade
				let lfo0=this.lfo[index];
				if(lfo0) lfo0.fade=0;
				break;
			case 5://lfo rate
				let lfo1=this.lfo[index];
				if(lfo1) lfo1.rate=1;
				break;
			case 6:// amp factor
				let amp0=this.amp[index];
				if(amp0) amp0.factor2=1;
				break;
			case 7:// amp phase
				let amp1=this.amp[index];
				if(amp1) amp1.phase=0;
				break;
			case 8:// effect value
				let names=this.effects.ControlNames();
				if(index in names){
					let name=names[index];
					this.effectValues[name]=0;
				}
				break;
		}
	}

	updateLFO(samples){
		for(const lfo of this.lfo){
			let amps=lfo.amps;
			for(let amp of amps){
				let index=amp.index;
				let factor=amp.factor*amp.factor2;
				let phase=amp.phase;
				let v=0;
				switch (amp.target){
					case 0://tremolo
						let fade=this.fadeBuffer;
						for (let i=0;i < samples;i++){
							v=lfo.Sample(i,phase);		
							fade[i]+=v*factor;
						}
						break;
					case 1://vibrato
						let rate=this.rateBuffer;
						for (let i=0;i < samples;i++){
							v=lfo.Sample(i,phase);
							rate[i]+=v*factor;
						}
						break;							
					case 2://filter cutoff
						let filter0=this.filter[index];
						v=lfo.Sample(samples,phase);
						if(filter0) {
							filter0.cutoff2=v*factor*100;
							filter0.updateCoefficients();
						}
						break;
					case 3://filter Q
						let filter1=this.filter[index];
						v=lfo.Sample(samples,phase);
						if(filter1) {
							filter1.Q2=v*factor;
							filter1.updateCoefficients();
						}
						break;
					case 4://lfo fade
						let lfo0=this.lfo[index];
						v=lfo.Sample(samples,phase);
						if(lfo0) lfo0.fade=v*factor;
						break;
					case 5://lfo rate
						let lfo1=this.lfo[index];
						v=lfo.Sample(samples,phase);
						if(lfo1) lfo1.rate=v*factor;
						break;
					case 6:// amp factor
						let amp0=this.amp[index];
						v=lfo.Sample(samples,phase);
						if(amp0) amp0.factor2=v;
						break;
					case 7:// amp phase
						let amp1=this.amp[index];
						v=lfo.Sample(samples,phase);
						if(amp1) amp1.phase=v;
						break;
					case 8:// effect value
						v=lfo.Sample(samples,phase);
						let names=this.effects.ControlNames();
						if(index in names){
							let name=names[index];
							this.effectValues[name]=v*factor;	// warning not safe, stay away
						}
						break;
				}
			}
			lfo.Step(samples);
		}
	}

	// MixAudiobuffers was FillAudioBuffer

	mixAudioBuffers(samples){

		let pan=this.effectValues["position_pan"]||0;
		let overdrive0=this.effectValues["distortion_overdrive"]||20;
		let gain0=this.effectValues["distortion_gain"]||1.0;
		let wet0=this.effectValues["reverb_wet"]||1;
		let dry0=this.effectValues["reverb_dry"]||1;
		let falloff0=this.effectValues["reverb_falloff"]||1.5;

		// hardcode modulation wheel test
		gain0*=(2.0+this.modulate)/5;

		let effect=this.effectBuffers;
		for (let i=0;i < samples;i++){
			this.buffer[i*2+0]=0;
			this.buffer[i*2+1]=0;
			this.rateBuffer[i]=1.0+this.detune0+i*(this.detune-this.detune0)/samples;
			this.fadeBuffer[i]=this.fade0+i*(this.fade-this.fade0)/samples;
			effect.overdrive[i]=overdrive0;
			effect.gain[i]=gain0;
			effect.wet[i]=wet0;
			effect.dry[i]=dry0;
			effect.falloff[i]=falloff0;
		}
		this.detune0= this.detune;
		this.fade0= this.fade;	
		// apply LFO matrix to 0 fade 1 gain 2 nextfade 3 nxextgain

		this.updateLFO(samples);

		//let controls=this.effectBuffers;
		let controls=[effect.overdrive,effect.gain,effect.wet,effect.dry,effect.falloff];

		this.root.FillAudioBuffer(this.buffer,samples,this.rateBuffer,this.fadeBuffer,pan);
		for (const [key,stream] of Object.entries(this.inputStreams)){
			stream.Mix(this.buffer,samples);
		}
		if(this.samplers){
			for (let sampler of this.samplers){
				let sampleControls=[];
				sampler.Mix(this.buffer,samples,sampleControls);
			}
		}
		if (this.effecting){
			this.effects.EffectAudio(this.buffer,samples,controls);
		}
		this.Duration += samples;

		if(this.scope){
			this.PlotScope(samples);
		}

		if(this.capture){
			this.captureAudio(samples);
		}

		if (this.recording){
			this.Record(this.buffer,samples);
		}
/*
		let keys=this.root.GetKeys();
		let keystate=keys.ToJson();
		if(keystate!=this.keystate){
			this.keystate=keystate;
			log("keystate : "+keystate)
		}
*/
		return this.buffer;
	}

	toggleRecord(){
		this.recording= !this.recording;
	}

	Panic(){
		this.SetSustain(false);
		this.root.Panic();
	}

	SetValue(slide){
		
	}

	SetEffect(effecting){
		this.effecting=effecting;
		log("effecting : "+(this.effecting?"true":"false"));
	}

	SetRecord(arm){
		if(arm && !this.recording){
			this.recordPos = 0;
			this.passCount = 0;
		}
		this.recording=arm;
		this.emitSnapshot();
	}

	SetSustain(sustain){
		this.root.SetSustain(sustain);
	}

	SetHold(hold){
		this.root.SetHold(hold);
	}

	SetTimbre(osc,env,pow){
		this.root.SetTimbre(osc,env,pow);
	}

	NoteOn(note,velocity){
		this.root.NoteOn(note,velocity);
	}

	NoteOff(note){
		this.root.NoteOff(note);
	}

	GetKeys(){
		return this.root.GetKeys();
	}

	// AudioWorkletProcessor entry point

	onCommands(commands){
		for(const line of commands){
//			log("[VSYNTH] "+JSON.stringify(line));
			switch(line.command){				
				case "pcm64":
					this.RawAudioIn(line);
					break;
				case "stop":
					this.Panic();
					break;
				case "panic":
					this.Panic();
					this.emitSnapshot();
					break;
				case "noteon":
					let note1=line.note+this.transpose;
 					let velocity=line.velocity;
					this.NoteOn(note1,velocity);
					break;
				case "noteoff":
					let note2=line.note+this.transpose;
					this.NoteOff(note2);
					break;
				case "controlchange":
					let control=line.control;
					switch(control){
						case 1:
							this.modulate=line.value;
//							log("modulate 1");
							break;
						case 4:
							this.modulate=line.value;//foot pedal
							break;
						case 6:
							this.SetValue(line.value);
							break;
						case 10:
							let pan=(line.value-64)/60.0;
							if(pan<-1) pan=-1;
							if(pan>1) pan=1;
							this.effectValues["position_pan"]=pan;
							break;
						case 64:
							this.SetSustain(line.value);
							break;
						case 44:
//							this.SetRecord(line.value>0);
							this.SetCapture(line.value>0);
							break;
						case 176://48://176:
							this.modulate=line.value;
							log("modulate 176");
							break;
						case 49:
							this.SetHold(line.value>0);
							break;
						case 50:
							this.SetEffect(line.value>0);
							break;
						case 96:
							this.transpose+=12;
							break;
						case 224://96://224:
							let bend=(line.value-8192)/8000;
							if ((bend*bend)<0.020) bend=0;
							if(bend>1) bend=1;
							if(bend<-1) bend=-1;
							this.detune=bend;
//							log("detune : "+bend)
							break;
						case 97:
							this.transpose-=12;
							break;
						case 123:
							this.Panic();
							break;
						default:
							log("?controller control : "+line.control+" value : "+line.value,true);
					}	
					break;
				case "beat":
					this.SetBeat(line.div,line.duty,line.reps);
					break;
				case "amp":
					this.SetAmp(line.id,line.lfo,line.target,line.index,line.factor);
					break;
				case "lfo":
					this.SetLFO(line.index,line.oscillator,line.power,line.frequency,line.sync,line.gain);
					break;
				case "filter":
					this.SetFilter(line.index,line.enabled,line.type,line.cutoff,line.Q);
					break;
				case "arp":
					this.SetArpeggiation(line.algo,line.prog);
					break;
				case "tempo":
					this.SetTempo(line.bpm);
					break;
				case "voice":
					this.SetMode(line.mode);
					this.SetTimbre(line.oscillator,line.envelope,line.power);
					break;
				case "snapshot":
					this.emitSnapshot();
					break;
				case "effect":
					let effect=line.control;
					let value=line.value;
					this.effectValues[effect]=value;
					break;
				default:
					log("VSynth::onEvent unsupported command : "+line.command,true);
				}
		}
	}
}
