/* eslint key-spacing    : 0 */
/* eslint no-unused-vars : 0 */

const convert = require('node-unit-conversion');


// Process to N decimal places
function ceil2(value, places = 2) {
	let multiplier = Number((1).toString().padEnd((places + 1), 0));
	return Math.ceil(value * multiplier + Number.EPSILON) / multiplier;
}

function floor2(value, places = 2) {
	let multiplier = Number((1).toString().padEnd((places + 1), 0));
	return Math.floor(value * multiplier + Number.EPSILON) / multiplier;
}

function round2(value, places = 2) {
	let multiplier = Number((1).toString().padEnd((places + 1), 0));
	return Math.round(value * multiplier + Number.EPSILON) / multiplier;
}


// This is dangerous and awesome if you can see what it does
function encode_316(rpm = 10000) {
	// Bounce if can0 is not enabled
	if (config.bus[config.dme.can_intf].enabled !== true) return;

	let rpm_orig = rpm;

	rpm = Math.floor(rpm * 6.4);

	let lsb = rpm        & 0xFF || 0; // LSB
	let msb = (rpm >> 8) & 0xFF || 0; // MSB

	let msg = Buffer.from([ 0x05, 0x16, lsb, msb, 0x16, 0x18, 0x00, 0x16 ]);

	let count = 500;

	// Send packets
	for (let i = 0; i < count; i++) {
		setTimeout(() => {
			bus.data.send({
				bus  : config.dme.can_intf,
				id   : 0x316,
				data : msg,
			});
		}, (i / 75));
	}

	log.module('Sent ' + count + 'x encoded CANBUS packets, ARBID 0x316, with RPM : ' + rpm_orig);
}

// For 0x316 byte 0
//
// Bit 0 - Something is pushed here, but I'm having a hard time tracing what it is. Appears it would always be set to 1 if everything is running normally
// Bit 1 - Unused (in this DME)
// Bit 2 - Set to 0 if DSC error, 1 otherwise
// Bit 3 - Set to 0 if manual, Set to 1 if SMG (on this DME, I guess MS45 is different)
// Bit 4 - Set to bit 0 of md_st_eingriff (torque intervention status)
// Bit 5 - Set to bit 1 of md_st_eingriff
// Bit 6 - Set to 1 AC engaged
// Bit 7 - Set to 1 if MAF error
function parse_316(data) {
	let mask_0 = bitmask.check(data.msg[0]).mask;

	let parse = {
		ac_clutch : mask_0.b7,

		rpm : ((data.msg[3] << 8) + data.msg[2]) / 6.4,

		key : {
			off       :  mask_0.b8,
			accessory : !mask_0.b0 && !mask_0.b1 && mask_0.b2 && !mask_0.b3 && !mask_0.b4,
			run       :  mask_0.b0 && !mask_0.b1 && mask_0.b2 && !mask_0.b3 && !mask_0.b4,
			start     :  mask_0.b0 && !mask_0.b1 && mask_0.b2 && !mask_0.b3 &&  mask_0.b4,
		},

		torque : {
			after_interventions  : round2(data.msg[1] / 2.55),
			before_interventions : round2(data.msg[4] / 2.55),
			loss                 : round2(data.msg[5] / 2.55),
			output               : round2(data.msg[7] / 2.55),
		},
	};

	update.status('engine.ac_clutch', parse.ac_clutch, false);

	update.status('vehicle.key.off',       parse.key.off,       false);
	update.status('vehicle.key.accessory', parse.key.accessory, false);
	update.status('vehicle.key.run',       parse.key.run,       false);
	update.status('vehicle.key.start',     parse.key.start,     false);

	// horsepower = (torque * RPM)/5252
	update.status('engine.torque.after_interventions',  parse.torque.after_interventions);
	update.status('engine.torque.before_interventions', parse.torque.before_interventions);
	update.status('engine.torque.loss',                 parse.torque.loss);
	update.status('engine.torque.output',               parse.torque.output);
}

function parse_329(data) {
	// byte2
	// 0 = Sport on (request by SMG transmission)
	// 1 = Sport off
	// 2 = Sport on
	// 3 = Sport error

	// byte3
	//
	//
	// ARBID: 0x329 (DME2)
	// byte 0 : ??
	// byte 1 : coolant temp
	// byte 2 : atmospheric pressure
	//
	// byte 3, bit 0      : clutch switch (0 = engaged, 1 = disengage/neutral)
	// byte 3, bit 2      : Hardcoded to 1 (on MSS54, could be used on other DMEs)
	// byte 3, bit 4      : possibly motor status (0 = on, 1 = off)
	// byte 3, bits 5+6+7 : tank evap duty cycle?
	//
	// byte 4 : driver desired torque, relative (0x00 - 0xFE)
	// byte 5 : throttle position               (0x00 - 0xFE)
	//
	// byte 6, bit 2 : kickdown switch depressed
	// byte 6, bit 1 : brake light switch error
	// byte 6, bit 0 : brake pedal depressed
	//
	// byte 7 : ??

	let parse = {
		engine : {
			// throttle : {
			// 	cruise : parseFloat((data.msg[4] / 2.54).toFixed(1)),
			// 	pedal  : parseFloat((data.msg[5] / 2.54).toFixed(1)),
			// },

			atmospheric_pressure : {
				mbar : (data.msg[2] * 2) + 597,
				mmhg : null,
				psi  : null,
			},
		},

		temperature : {
			coolant : {
				c : Math.floor((data.msg[1] * 0.75) - 48),
				f : null,
			},
		},

		vehicle : {
			brake    : bitmask.test(data.msg[6], 0x01),
			clutch   : bitmask.test(data.msg[3], 0x01),
			kickdown : bitmask.test(data.msg[6], 0x04),

			cruise : {
				button : {
					resume :  bitmask.test(data.msg[3], 0x20) &&  bitmask.test(data.msg[3], 0x40),
					minus  : !bitmask.test(data.msg[3], 0x20) &&  bitmask.test(data.msg[3], 0x40),
					plus   :  bitmask.test(data.msg[3], 0x20) && !bitmask.test(data.msg[3], 0x40),
					onoff  :  bitmask.test(data.msg[3], 0x80),
					unk1   :  bitmask.test(data.msg[3], 0x01),
				},

				status : {
					activating : bitmask.test(data.msg[6], 0x20),
					active     : bitmask.test(data.msg[6], 0x08),
					resume     : bitmask.test(data.msg[6], 0x10),
					unk1       : bitmask.test(data.msg[6], 0x01),
				},
			},

			sport : {
				active : bitmask.test(data.msg[5], 0x02),
			},
		},
	};

	// Calculate mmhg and psi atmospheric pressure values
	parse.engine.atmospheric_pressure.mmhg = round2(parse.engine.atmospheric_pressure.mbar * 0.75006157818041);
	parse.engine.atmospheric_pressure.psi  = round2(parse.engine.atmospheric_pressure.mbar * 0.01450377380072);

	// Calculate fahrenheit temperature values
	parse.temperature.coolant.f = Math.floor(convert(parse.temperature.coolant.c).from('celsius').to('fahrenheit'));

	// Update status object
	update.status('engine.atmospheric_pressure.mbar', parse.engine.atmospheric_pressure.mbar);
	update.status('engine.atmospheric_pressure.mmhg', parse.engine.atmospheric_pressure.mmhg);
	update.status('engine.atmospheric_pressure.psi',  parse.engine.atmospheric_pressure.psi);

	update.status('vehicle.cruise.button.minus',  parse.vehicle.cruise.button.minus,  false);
	update.status('vehicle.cruise.button.onoff',  parse.vehicle.cruise.button.onoff,  false);
	update.status('vehicle.cruise.button.plus',   parse.vehicle.cruise.button.plus,   false);
	update.status('vehicle.cruise.button.resume', parse.vehicle.cruise.button.resume, false);
	update.status('vehicle.cruise.button.unk1',   parse.vehicle.cruise.button.unk1,   false);

	update.status('vehicle.cruise.status.activating', parse.vehicle.cruise.status.activating, false);
	update.status('vehicle.cruise.status.active',     parse.vehicle.cruise.status.active,     false);
	update.status('vehicle.cruise.status.resume',     parse.vehicle.cruise.status.resume,     false);
	update.status('vehicle.cruise.status.unk1',       parse.vehicle.cruise.status.unk1,       false);

	// update.status('engine.throttle.cruise', parse.engine.throttle.cruise);
	// update.status('engine.throttle.pedal',  parse.engine.throttle.pedal);

	// update.status('vehicle.sport.active', parse.vehicle.sport.active, false);

	update.status('temperature.coolant.c', parse.temperature.coolant.c, false);
	update.status('temperature.coolant.f', parse.temperature.coolant.f);

	update.status('vehicle.brake',  parse.vehicle.brake, false);

	if (update.status('vehicle.clutch', parse.vehicle.clutch, false)) {
		if (parse.vehicle.clutch === false && status.engine.running === true) {
			update.status('vehicle.clutch_count', parseFloat((status.vehicle.clutch_count + 1)), false);
		}
	}
}

// MS45/MSD80/MSV80 only
function parse_338(data) {
	// Byte 2, bit 0 : Sport on (request by SMG transmission)
	// Byte 2, bit 1 : Sport off
	// Byte 2, bit 2 : Sport on
	// Byte 2, bit 3 : Sport error

	// let parse = {
	// 	msg     : '0x338',
	// 	vehicle : {
	// 		sport : {
	// 			active : ((data.msg[2] === 0x00 || data.msg[2] === 0x02) && (data.msg[2] !== 0x01 && data.msg[2] !== 0x03)),
	// 			error  : data.msg[2] === 0x03,
	// 		},
	// 	},
	// };

	// update.status('vehicle.sport.active', parse.vehicle.sport.active, false);
	// update.status('vehicle.sport.error',  parse.vehicle.sport.error,  false);

	return data;
}

// Byte 0, bit 1 : Check engine
// Byte 0, bit 3 : Cruise
// Byte 0, bit 4 : EML
// Byte 0, bit 7 : Check gas cap
//
// Byte 3, bit 0 : Oil level error, if motortype = S62
// Byte 3, bit 1 : Oil level warning
// Byte 3, bit 2 : Oil level error
// Byte 3, bit 3 : Overheat Light
// Byte 3, bit 4 : M3/M5 tachometer light
// Byte 3, bit 5 : M3/M5 tachometer light
// Byte 3, bit 6 : M3/M5 tachometer light
//
// Byte 4 : Oil temperature (ºC = X - 48)
// Byte 5 : Charge light (0 = off, 1 = on; only used on some DMEs)
// Byte 6 : CSL oil level (format unclear)
// Byte 7 : Possibly MSS54 TPM trigger
function parse_545(data) {
	let process_consumption = true;

	let consumption_current = ((data.msg[2] << 8) + data.msg[1]);

	// Need at least one value first
	if (DME.consumption_last === 0) {
		DME.consumption_last = consumption_current;
		process_consumption = false;
	}

	// The amount of fuel being consumed isn't a flat number
	// It's the difference between two numbers factoring in the time between the time both numbers were received

	let parse = {
		fuel : {
			consumption : consumption_current - DME.consumption_last,
		},

		status : {
			check_engine  : bitmask.test(data.msg[0], bitmask.b[1]),
			check_gas_cap : bitmask.test(data.msg[0], bitmask.b[7]),
			cruise        : bitmask.test(data.msg[0], bitmask.b[3]),
			eml           : bitmask.test(data.msg[0], bitmask.b[4]),
		},

		temperature : {
			oil : {
				c : data.msg[4] - 48,
				f : null,
			},
		},
	};

	if (process_consumption === true) {
		DME.consumption_last = consumption_current;
		update.status('fuel.consumption', parse.fuel.consumption);
	}

	// Calculate fahrenheit temperature values
	parse.temperature.oil.f = parseFloat(convert(parse.temperature.oil.c).from('celsius').to('fahrenheit'));

	// Update status object
	update.status('dme.status.check_engine',  parse.status.check_engine,  false);
	update.status('dme.status.check_gas_cap', parse.status.check_gas_cap, false);
	update.status('dme.status.cruise',        parse.status.cruise,        false);
	update.status('dme.status.eml',           parse.status.eml,           false);

	update.status('temperature.oil.f', parse.temperature.oil.f);
	update.status('temperature.oil.c', parse.temperature.oil.c, false);
}


// byte0 : Odometer LSB
// byte1 : Odometer MSB
// byte2 : Fuel level
// byte3 : Running clock LSB
// byte4 : Running clock MSB
//
// Running clock = minutes since last time battery power was lost
//
// This is actually sent by IKE
function parse_613(data) {
	let parse = {
		vehicle : {
			odometer : {
				km : ((data.msg[1] << 8) + data.msg[0]) * 10,
				mi : null,
			},

			running_clock : ((data.msg[4] << 8) + data.msg[3]),
		},

		// Looks bad, I should feel bad
		fuel : {
			level  : null,
			liters : (data.msg[2] >= 0x80) && data.msg[2] - 0x80 || data.msg[2],
		},
	};

	parse.fuel.level = Math.floor((parse.fuel.liters / config.fuel.liters_max) * 100);
	if (parse.fuel.level < 0)   parse.fuel.level = 0;
	if (parse.fuel.level > 100) parse.fuel.level = 100;

	update.status('fuel.level',  parse.fuel.level, false);
	update.status('fuel.liters', parse.fuel.liters);

	parse.vehicle.odometer.mi = Math.floor(convert(parse.vehicle.odometer.km).from('kilometre').to('us mile'));

	update.status('vehicle.odometer.km', parse.vehicle.odometer.km);
	update.status('vehicle.odometer.mi', parse.vehicle.odometer.mi, false);

	update.status('vehicle.running_clock', parse.vehicle.running_clock, false);
}

// ARBID: 0x615 sent from the instrument cluster
function parse_615(data) {
	// byte0 : AC signal, 0x80 when on, other bits say something else (load, aux fan speed request? system pressure?)
	// byte1 : 0x04 = headlights/parking lights on
	// byte2 : ??
	// byte3 : Outside air temperature
	// byte4 : 0x01 = Driver door open, 0x02 = handbrake up
	// byte5 : 0x02 = Left turn signal, 0x04 = Right turn signal, 0x06 = hazards

	let parse = {
		engine : {
			ac_request    : data.msg[0],
			aux_fan_speed : (data.msg[0] >= 0x80) && data.msg[0] - 0x80 || data.msg[0],
		},

		temperature : {
			exterior : {
				c : (data.msg[3] >= 0x80) && data.msg[3] - 0x80 || data.msg[3],
				f : null,
			},
		},

		vehicle : {
			handbrake : bitmask.test(data.msg[4], 0x02),
		},
	};

	// Calculate fahrenheit temperature values
	parse.temperature.exterior.f = parseFloat(convert(parse.temperature.exterior.c).from('celsius').to('fahrenheit'));

	// Round temperature values
	parse.temperature.exterior.c = Math.floor(parse.temperature.exterior.c);
	parse.temperature.exterior.f = Math.floor(parse.temperature.exterior.f);

	// Update status object
	update.status('engine.ac_request',    parse.engine.ac_request,    false);
	update.status('engine.aux_fan_speed', parse.engine.aux_fan_speed, false);

	update.status('temperature.exterior.c', parse.temperature.exterior.c, false);
	update.status('temperature.exterior.f', parse.temperature.exterior.f);

	update.status('vehicle.handbrake', parse.vehicle.handbrake, false);
}

// ARBID: 0x720 sent from MSS5x on secondary CANBUS - connector X60002 at pins 21 (low) and 22 (high)
// B0 = Coolant temp
// B1 = Intake temp
// B2 = Exhaust gas temp
// B3 = Oil temp
// B4 = Voltage * 10
// B5,B6 = Speed
// B7 = Fuel pump duty cycle
//
// Example : [ 0x40, 0x4A, 0x03, 0x3E, 0x7C, 0x00, 0x00, 0x00 ]
function parse_720(data) {
	let parse = {
		dme : {
			voltage : data.msg[4] / 10,
		},

		fuel : {
			pump : {
				duty    : data.msg[7],
				percent : floor2(data.msg[7] / 2.55),
			},
		},

		temperature : {
			// coolant : {
			// 	c : data.msg[0] - 48,
			// 	f : null,
			// },

			exhaust : {
				c : data.msg[2] << 2,
				f : null,
			},

			// oil : {
			// 	c : data.msg[3] - 48,
			// 	f : null,
			// },

			intake : {
				c : data.msg[1] - 48,
				f : null,
			},
		},
	};

	// Update status object

	// update.status('temperature.coolant.c', parse.temperature.coolant.c);
	// update.status('temperature.oil.c',     parse.temperature.oil.c);
	update.status('temperature.exhaust.c', parse.temperature.exhaust.c, false);
	update.status('temperature.intake.c',  parse.temperature.intake.c,  false);

	update.status('dme.voltage',       parse.dme.voltage);
	update.status('fuel.pump.duty',    parse.fuel.pump.duty);
	update.status('fuel.pump.percent', parse.fuel.pump.percent);

	// Calculate fahrenheit temperature values
	// parse.temperature.coolant.f = parseFloat(convert(parse.temperature.coolant.c).from('celsius').to('fahrenheit'));
	parse.temperature.exhaust.f = parseFloat(convert(parse.temperature.exhaust.c).from('celsius').to('fahrenheit'));
	parse.temperature.intake.f  = parseFloat(convert(parse.temperature.intake.c).from('celsius').to('fahrenheit'));
	// parse.temperature.oil.f     = parseFloat(convert(parse.temperature.oil.c).from('celsius').to('fahrenheit'));

	// update.status('temperature.coolant.f', parse.temperature.coolant.f);
	// update.status('temperature.oil.f',     parse.temperature.oil.f);
	update.status('temperature.exhaust.f', parse.temperature.exhaust.f);
	update.status('temperature.intake.f',  parse.temperature.intake.f);
}

function parse_out_low(data) {
	switch (data.msg[0]) {
		default:
			data.command = 'unk';
			data.value   = Buffer.from(data.msg);
	}

	if (data.dst === null || typeof data.dst === 'undefined') {
		data.dst = {
			id   : 0x12,
			name : 'DME',
		};
	}

	if (data.msg[0] === null || typeof data.msg[0] === 'undefined') {
		data.msg = [ 0xFF ];
	}

	log.bus(data);
}


// Parse data sent from module
function parse_out(data) {
	data.command = 'bro';

	switch (data.bus) {
		case 'ibus' :
		case 'dbus' :
		case 'kbus' : {
			parse_out_low(data);
			return;
		}
	}

	switch (data.src.id) {
		case 0x316 : {
			data.value = 'AC clutch/Throttle/RPM';
			parse_316(data);
			break;
		}

		case 0x329 : {
			data.value = 'Temp/Brake pedal depressed/Throttle position';
			parse_329(data);
			break;
		}

		case 0x338 : {
			data.value = 'Sport mode status';
			parse_338(data);
			break;
		}

		case 0x545 : {
			data.value = 'CEL/Fuel cons/Overheat/Oil temp/Charging/Brake light switch/Cruise control';
			parse_545(data);
			break;
		}

		case 0x610 : {
			data.value = 'VIN/info';
			break;
		}

		case 0x613 : {
			data.value = 'Odometer/Running clock/Fuel level [0x615 ACK]';
			parse_613(data);
			break;
		}

		case 0x615 : {
			data.value = 'A/C request/Outside air temp/Parking brake/door contacts';
			parse_615(data);
			break;
		}

		case 0x720 : {
			data.value = 'Coolant temp/Intake air temp/Exhaust gas temp/Oil temp/Voltage/Speed/Fuel pump duty';
			parse_720(data);
			break;
		}

		default : {
			data.value = data.src.id.toString(16);
		}
	}

	// log.bus(data);
}

// Request various things from DME
function request(value) {
	// Init variables
	let src;
	let cmd;

	switch (value) {
		case 'motor-values' : {
			src = 'DIA';
			cmd = [ 0xB8, 0x12, 0xF1, 0x03, 0x22, 0x40, 0x00 ];
			break;
		}

		default : return;
	}

	bus.data.send({
		src : src,
		dst : 'DME',
		msg : cmd,
	});
}


function init_listeners() {
	// If configured, send RPM 10000 on 0x316 on ignition in run
	update.on('status.vehicle.ignition', (data) => {
		if (data.new         !== 'run') return;
		if (config.ike.sweep !== true) return;

		encode_316(10000);
	});

	log.msg('Initialized listeners');
}


module.exports = {
	// Variables
	consumption_last : 0,

	// Functions
	encode_316     : encode_316,
	init_listeners : init_listeners,
	parse_out      : parse_out,
	request        : request,
};
