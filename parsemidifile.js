// parsemidi.js 
// (c)2025 Simon Armstrong
// All rights reserved

// SMPTE timing incoming

const MIDI_LOG_CONTROL_CHANGE = false;
const MIDI_LOG_SYSEX = true;

// standard midi meta 0xff commands

const MIDI_TRACK_TEXT = 0x01;
const MIDI_TRACK_COPYRIGHT = 0x02;
const MIDI_TRACK_NAME = 0x03;
const MIDI_TRACK_INSTRUMENT = 0x04;
const MIDI_TRACK_LYRIC = 0x05;
const MIDI_TRACK_MARK = 0x06;
const MIDI_TRACK_CUE = 0x07;
const MIDI_TRACK_PROGRAM = 0x08;
const MIDI_TRACK_DEVICE = 0x09;
const MIDI_CHANNEL = 0x20;
const MIDI_PORT = 0x21;
const MIDI_END_OF_TRACK = 0x2F;
const MIDI_TEMPO = 0x51;
const MIDI_SMPTE = 0x54;
const MIDI_TIME_SIGNATURE = 0x58;
const MIDI_KEY_SIGNATURE = 0x59;

// standard midi events

const MIDI_NOTE_OFF = 0x80;
const MIDI_NOTE_ON = 0x90;
const MIDI_AFTER_TOUCH = 0xA0;
const MIDI_CONTROL_CHANGE = 0xB0;
const MIDI_PROGRAM_CHANGE = 0xC0;
const MIDI_PRESSURE = 0xD0;
const MIDI_PITCH_BEND = 0xE0;
const MIDI_SYSEX = 0xF0;

function parseMIDITrack(ppqn,trackData,id,titles,text) {
	let events = [];
	let count = 0; // midiEvent count excludes meta controls
	let tick = 0;
	let time = 0;
	let index = 0;
	let channel = 0;

//	let ppqn = 960; // typical 4/4 time setting
	let tempo = 500000;  // 120bpm
	let bpm = 120;

	var runningStatus;
	
	while (index < trackData.length) {
		// variable length time in ticks
		let ticks = 0;
		while(true){
			let byte = trackData[index++];
			ticks = (ticks << 7) | (byte & 0x7F);
			if (!(byte & 0x80)) break;
		}
		tick+=ticks;

		let millis=ticksToMillis(ticks,ppqn,bpm);
		time+=millis;

		// single midi channel event 
		let byte = trackData[index++];	
		if (byte === 0xFF) {
			let metaEventType = trackData[index++];
//			let metaEventLength = trackData[index++];


			let metaEventLength = 0;
			while(true){
				let byte = trackData[index++];
				metaEventLength = (metaEventLength << 7) | (byte & 0x7F);
				if (!(byte & 0x80)) break;
			}
				
			let _data = trackData.slice(index, index + metaEventLength);
			index += metaEventLength;
			let meta={};
			switch (metaEventType) {
				case 0x7f:
					mlog(".midi 0x7f ya ya");
					break;
				case MIDI_TRACK_COPYRIGHT:
					meta.copyright=String.fromCharCode(..._data);
					log(".midi copyright : "+meta.copyright);					
					break;
				case MIDI_TRACK_TEXT:
				case MIDI_TRACK_LYRIC:
					let line=String.fromCharCode(..._data);
					text.push(line);
					mlog(".midi text : "+line);
					meta.text=line;
					break;
				case MIDI_TRACK_NAME:
					let title=String.fromCharCode(..._data);
					titles.push(title);
					mlog(".midi title : "+title);
					meta.title=title;
					break;
				case MIDI_TRACK_MARK:
					meta.marker=String.fromCharCode(..._data);
					mlog(".midi mark : "+meta.marker);					
					break;
				case MIDI_TRACK_INSTRUMENT:
					meta.instrument=String.fromCharCode(..._data);
					mlog(".midi instrument : "+meta.instrument);
					break;
				case MIDI_CHANNEL:
					channel=_data[0];
					meta.channel=channel;
					log(".midi channel : "+channel);
					break;
				case MIDI_PORT:
					meta.port=_data[0];
					mlog(".midi port : "+meta.port);
					break;
				case MIDI_TEMPO:
					tempo = (_data[0] << 16) | (_data[1] << 8) | _data[2];
					meta.tempo = tempo;
					bpm=(60e6/tempo);
					mlog(".midi tempo : "+tempo+" bpm : "+bpm);
					break;
				case MIDI_TIME_SIGNATURE:
					meta.time={numerator:_data[0],denominator:_data[1],metronome:_data[2],pqn:_data[3]};
					mlog(".midi time : "+JSON.stringify(meta.time));
					break;
				case MIDI_KEY_SIGNATURE:
					meta.key={sharpflats:_data[0],majorminor:_data[1]};
					mlog(".midi key : "+_data[0]+" , "+_data[1])
					break;
				case MIDI_END_OF_TRACK:
					meta.stop=true;
					mlog(".midi end of track");
					break;
				case MIDI_SMPTE:
					meta.smpte_frameRate = _data[0]; // frame rate, e.g., 24, 25, 29, 30
					meta.smpte_ticksPerFrame = _data[1]; // ticks per frame
					meta.smpte_timeCodeInfo = _data[2]; // SMPTE timecode
					log(".midi smpte  framerate : "+meta.smpte_frameRate+" ticksperframe : "+meta.smpte_ticksPerFrame+" timecode : "+meta.smpte_timeCodeInfo);
					break;	
				default:
					log(".midi missing case metaEventType : 0x"+metaEventType.toString(16));
					return null;
					break;
			}
			let name="meta";
			let type="meta:0x"+metaEventType.toString(16);
			events.push({ name, type, data: _data,  tick, time, meta });
		}
		else
		{
// runningStatus
			if (byte<0x80){
				byte = runningStatus;
				index--;

			}
			let result = null;
			let channel = byte & 0x0F;
			let eventType = byte & 0xF0;

			switch (eventType) {
				case MIDI_AFTER_TOUCH:
					let note = trackData[index++];
					let press = trackData[index++];
					result = { name:"after touch",note,pressure:press,channel,tick,time};
					break;
				case MIDI_PRESSURE:
					let pressure = trackData[index++];
					result = { name:"pressure",pressure,channel,tick,time};
					break;    
				case MIDI_NOTE_ON:
					let noteNumber = trackData[index++];
					let noteVelocity = trackData[index++];
					result = { name: "note on", note: noteNumber, velocity: noteVelocity,channel,tick,time };
					break;
				case MIDI_NOTE_OFF:
					let noteOffNumber = trackData[index++];
					let noteOffVelocity = trackData[index++];
					result = { name: "note off", note: noteOffNumber, velocity: noteOffVelocity,channel,tick,time };
					break;
				case MIDI_CONTROL_CHANGE:
					let controlNumber = trackData[index++];
					let controlValue = trackData[index++];
					result = { name: "control change", control: controlNumber, value: controlValue,channel,tick,time };
					if(MIDI_LOG_CONTROL_CHANGE){	
						let name=MIDI_CONTROL_NAMES[controlNumber]||"Control"+controlNumber;
						log("control change : "+name+" value : "+controlValue);
					}
					break;
				case MIDI_PROGRAM_CHANGE:
					let programNumber = trackData[index++];
					result = { name: "program change", program: programNumber,channel,tick,time };
					break;
				case MIDI_PITCH_BEND:
					let pitchBendLSB = trackData[index++];
					let pitchBendMSB = trackData[index++];
					let pitchBendValue = (pitchBendMSB << 7) | pitchBendLSB;
					result = { name: "pitch bend", value: pitchBendValue,channel,tick,time };
					break;
				case MIDI_SYSEX:
					let sysex=[];
					while(index<trackData.length){
						let byte=trackData[index++];
						if(byte==0xf7){
							break;
						}
						sysex.push(byte);//.toString(16));						
					}
					if(MIDI_LOG_SYSEX){
						mlog("midi: sysex : "+JSON.stringify(sysex));
					}
					break;
				default:
					log("midi: missing eventType case  byte : 0x"+byte.toString(16));
//					return null;
					break;
			}
//			log("result "+JSON.stringify(result));
			if(result){
				events.push(result);
				count++;
			}
			runningStatus=byte;
		}
	}
	// last tick played should hopefully be meta.stop
	return {id,channel,count,events,tick,index,ppqn};
}

function ticksToMillis(ticks, ppqn, bpm) {
    const ticksPerMilli = bpm * ppqn / 60000;
	if(ticksPerMilli==0) return 0;
    return ticks / ticksPerMilli;
}

function sliceTrackBytes(raw, offset) {
	// MTrk
	const isTrack = (raw[offset]==0x4d && raw[offset+1]==0x54 && raw[offset+2]==0x72 && raw[offset+3]==0x6b);
	if (!isTrack) {
		throw new Error('Invalid track chunk.');
	}
	const trackLength = (raw[offset+4]<<24) | (raw[offset+5]<<16) | (raw[offset+6]<<8) | raw[offset+7];
	const trackData = raw.slice(offset+8,offset+8+trackLength);
	return trackData;
}
	
function parseMIDI(name,raw){
	// MThd
	const isMidi=(raw[0]==0x4d&&raw[1]==0x54&&raw[2]==0x68&&raw[3]==0x64);
	if(isMidi){
		const headerLength = (raw[4] << 24) | (raw[5] << 16) | (raw[6] << 8) | raw[7];
		const midiFormat = (raw[8] << 8) | raw[9];
		const trackCount = (raw[10] << 8) | raw[11];
		const ppqn=(raw[12] << 8) | raw[13];
		const smpte=!!(ppqn&0x8000);
		if(smpte){
//		The upper byte (signed) specifies the SMPTE format (-24, -25, -29, or -30 frames per second).
//		The lower byte specifies ticks per frame (how many MIDI clock pulses per frame).		
			log("SMPTE timing not supported raw[12]:"+raw[12]+" raw[13]:"+raw[13]);
			throw new Error('SMPTE not yet supported');
		}
		const tracks=[];
		const titles=[];
		const events=[];
		const text=[];
		let count=0;
		let offset=14;
		for (let i = 0; i < trackCount; i++) {
			const raw2 = sliceTrackBytes(raw, offset);
			offset += raw2.length+8;
			let id="track "+(i+1);
			let track=parseMIDITrack(ppqn||480,raw2,id,titles,text);
			if(!track) return null;
			count+=track.events.length;
			tracks.push(track);
		}
		log("parseMidi name : "+name+" midiFormat : "+midiFormat+" trackCount : "+trackCount+" tracks : "+tracks.length+" count : "+count);
		return { name, midiFormat, trackCount, tracks };
	}
	return null;
}

function mlog(line){
//	console.log(line);
}