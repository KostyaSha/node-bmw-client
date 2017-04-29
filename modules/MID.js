var module_name = __filename.slice(__dirname.length + 1, -3);

// Interval var
var interval_status_loop;

// ASCII to hex for MID message
function ascii2hex(str) {
	var array = [];
	for (var n = 0, l = str.length; n < l; n ++) {
		var hex = str.charCodeAt(n);
		array.push(hex);
	}
	return array;
}

// Top screen - First 11 characters
// 68 C0 23 00 20 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F CK
// Top screen - Right half (20 char)
// 80 C0 23 00 20 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F 2F CK
// Menu - First 3 boxes
// 68 C0 21 00 15 20 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F CK
// Menu - Last 3 boxes
// 68 C0 21 00 15 06 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F 05 2F 2F 2F 2F CK

function text(message) {
	log.msg({ src: module_name, msg: 'Sending text to MID screen: \''+message+'\'' });

	var message_hex = [0x23, 0x40, 0x20];
	var message_hex = message_hex.concat(ascii2hex(pad(20, message.substring(0, 20))));

	bus_client.data_send({
		src: 'IKE',
		dst: 'MID',
		msg: message_hex,
	});

	var message_hex = [0x21, 0x00, 0x15, 0x20];

	var message = 'Pair';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Unpa';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Conn';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Dscn';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Back';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Next';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));

	bus_client.data_send({
		src: 'RAD',
		dst: 'MID',
		msg: message_hex,
	});

	var message_hex = [0x21, 0x00, 0x15, 0x06];

	var message = 'Paus';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'Play';
	var message_hex = message_hex.concat(ascii2hex(pad(4, message).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'AL+';
	var message_hex = message_hex.concat(ascii2hex(pad(message, 4).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	var message = 'AL-';
	var message_hex = message_hex.concat(ascii2hex(pad(4, message).substring(0, 4)));
	var message_hex = message_hex.concat(0x05);

	bus_client.data_send({
		src: 'RAD',
		dst: 'MID',
		msg: message_hex,
	});
}

// Set or unset the status interval
function status_loop(action) {
	if (config.emulate.mid !== true) {
		return;
	}

	switch (action) {
		case 'set':
			refresh_status();
			interval_status_loop = setInterval(() => {
				refresh_status();
			}, 20000);
			break;

		case 'unset':
			clearInterval(interval_status_loop, () => {
			});
			break;
	}

	log.msg({
		src : 'MID',
		msg : 'Ping interval '+action,
		});
}

// Send MID status, and request status from RAD
function refresh_status() {
	if (status.vehicle.ignition_level > 0) {
		bus_commands.request_device_status(module_name, 'RAD');
		return;
	}

	status_loop(false);
}

// Send the power on button command if needed/ready
function power_on_if_ready() {
	if (config.emulate.mid !== true) {
		return;
	}

	// Debug logging
	// console.log('[node:MID] dsp.ready         : \'%s\'', status.dsp.ready);
	// console.log('[node:MID] rad.audio_control : \'%s\'', status.rad.audio_control);

	if (status.rad.audio_control == 'audio off' && status.dsp.ready === true) {
		log.msg({
			src : module_name,
			msg : 'Sending power!',
		});
		send_button('power');
		DSP.request('memory'); // Get the DSP memory
	}
}

// Parse data sent to MID module
function parse_in(data) {
	// Init variables
	switch (data.msg[0]) {
		case 0x01: // Request: device status
			data.command = 'req';
			data.value = 'device status';

			// Send the ready packet since this module doesn't actually exist
			if (config.emulate.mid === true) {
				bus_commands.send_device_status(module_name);
			}
			break;

		case 0x02: // Device status
			data.command = 'bro';
			data.value   = 'device status ';
			switch (data.msg[1]) {
				case 0x00:
					data.value = data.value+'ready';
					break;
				case 0x01:
					data.value = data.value+'ready after reset';
					break;
			}
			break;

		default:
			data.command = 'unk';
			data.value = Buffer.from(data.msg);
			break;
	}

	log.bus(data);
}

// Parse data sent from MID module
function parse_out(data) {
	// Init variables
	var command;
	var value;

	switch (data.msg[0]) {
		case 0x20: // Broadcast: display status
			data.command = 'bro';
			data.value   = 'display status: ';
			break;

		case 0x31: // Broadcast: button pressed
			data.command = 'bro';
			data.value   = 'button pressed: '+data.msg[1]+' '+data.msg[2]+' '+data.msg[3];

			if (data.msg[1] == 0x00 && data.msg[2] == 0x15) {
				switch (data.msg[3]) {
					case 0x02: BT.command('connect'); break;
					case 0x03: BT.command('disconnect'); break;
					case 0x04: BT.command('previous'); break;
					case 0x05: BT.command('next'); break;
					case 0x06: BT.command('pause'); break;
					case 0x07: BT.command('play'); break;
					case 0x08: LCM.auto_lights(true); break;
					case 0x09: LCM.auto_lights(false); break;
				}
			}

			// 00 00 01,MID,RAD,Button Button_1_pressed
			// 00 00 03,MID,RAD,Button Button_3_pressed
			// 00 00 03,MID,RAD,Button TP_MUTE_pressed
			// 00 00 04,MID,RAD,Button Button_4_pressed
			// 00 00 04,MID,RAD,Button VOLUME_+_pressed
			// 00 00 05,MID,RAD,Button Button_5_pressed
			// 00 00 06,MID,RAD,Button Button_6_pressed
			// 00 00 06,MID,RAD,Button SEEK_<_pressed
			// 00 00 07,MID,RAD,Button SEEK_>_pressed
			// 00 00 08,MID,RAD,Button CC/CD_pressed
			// 00 00 09,MID,RAD,Button FM_pressed
			// 00 00 0A,MID,RAD,Button Button_A_pressed
			// 00 00 0B,MID,RAD,Button Button_B_pressed
			// 00 00 0B,MID,RAD,Button TONE_pressed
			// 00 00 0C,MID,RAD,Button MAN_pressed
			// 00 00 0D,MID,RAD,Button Button_D_pressed
			// 00 00 0D,MID,RAD,Button MEM_pressed
			// 00 00 0E,MID,RAD,Button SC/RP_pressed
			// 00 00 23,MID,RAD,Button Button_3_pressed_long
			// 00 00 25,MID,RAD,Button Button_5_pressed_long
			// 00 00 2B,MID,RAD,Button Button_B_pressed_long
			// 00 00 2D,MID,RAD,Button Button_D_pressed_long
			// 00 00 41,MID,RAD,Button Button_1_released
			// 00 00 43,MID,RAD,Button Button_3_released
			// 00 00 43,MID,RAD,Button TP_MUTE_released
			// 00 00 44,MID,RAD,Button Button_4_released
			// 00 00 44,MID,RAD,Button VOLUME_+_released
			// 00 00 45,MID,RAD,Button Button_5_released
			// 00 00 46,MID,RAD,Button Button_6_released
			// 00 00 46,MID,RAD,Button SEEK_<_released
			// 00 00 47,MID,RAD,Button SEEK_>_released
			// 00 00 48,MID,RAD,Button CC/CD_released
			// 00 00 49,MID,RAD,Button FM_released
			// 00 00 4A,MID,RAD,Button Button_A_released
			// 00 00 4B,MID,RAD,Button Button_B_released
			// 00 00 4B,MID,RAD,Button TONE_released
			// 00 00 4C,MID,RAD,Button MAN_released
			// 00 00 4D,MID,RAD,Button Button_D_released
			// 00 00 4D,MID,RAD,Button MEM_released
			// 00 00 4E,MID,RAD,Button SC/RP_released
			// 00 10 06,MID,RAD,Button Button_6_pressed
			// 00 10 0B,MID,RAD,Button Button_B_pressed
			// 00 10 46,MID,RAD,Button Button_6_released
			// 00 10 4B,MID,RAD,Button Button_B_released
			// 00 15 07,MID,RAD,Button Button_7_pressed
			// 00 15 0B,MID,RAD,Button Button_B_pressed
			// 00 15 47,MID,RAD,Button Button_7_released
			// 00 15 4B,MID,RAD,Button Button_B_released
			// 00 21 06,MID,RAD,Button Button_6_pressed
			// 00 21 46,MID,RAD,Button Button_6_released
			// 00 33 04,MID,RAD,Button Button_4_pressed
			// 00 33 06,MID,RAD,Button Button_6_pressed
			// 00 33 09,MID,RAD,Button Button_9_pressed
			// 00 33 0A,MID,RAD,Button Button_A_pressed
			// 00 33 0B,MID,RAD,Button Button_B_pressed
			// 00 33 44,MID,RAD,Button Button_4_released
			// 00 33 46,MID,RAD,Button Button_6_released
			// 00 33 49,MID,RAD,Button Button_9_released
			// 00 33 4A,MID,RAD,Button Button_A_released
			// 00 33 4B,MID,RAD,Button Button_B_released
			// 00 34 02,MID,RAD,Button Button_2_pressed
			// 00 34 04,MID,RAD,Button Button_4_pressed
			// 00 34 08,MID,RAD,Button Button_8_pressed
			// 00 34 0B,MID,RAD,Button Button_B_pressed
			// 00 34 2B,MID,RAD,Button Button_B_pressed_long
			// 00 34 42,MID,RAD,Button Button_2_released
			// 00 34 44,MID,RAD,Button Button_4_released
			// 00 34 48,MID,RAD,Button Button_8_released
			// 00 34 4B,MID,RAD,Button Button_B_released
			// 00 35 03,MID,RAD,Button Button_3_pressed
			// 00 35 43,MID,RAD,Button Button_3_released
			// 00 46 06,MID,RAD,Button Button_6_pressed
			// 00 46 46,MID,RAD,Button Button_6_released
			// 01 20 00,MID,IKE,Button Button_0_pressed
			// 01 20 40,MID,IKE,Button Button_0_released
			break;

		case 0x32: // Broadcast: Volume control
			data.command = 'con';
			var volume = data.msg[1];

			// Determine volume change direction
			if (bitmask.bit_test(volume, 0x01)) {
				var direction = '+';
				var volume = parseFloat(volume)-1;
			}
			else {
				var direction = '-';
				var volume = parseFloat(volume);
			}

			switch (volume) {
					case 0x10 : volume = 1; break;
					case 0x20 : volume = 2; break;
					case 0x30 : volume = 3; break;
					case 0x40 : volume = 4; break;
					case 0x50 : volume = 5; break;
					case 0x96 : volume = 9; break;
					case 0xA0 : volume = 10; break;
						// 112 128 96
			}

			data.value = 'volume '+direction+volume;

			// data.msg[1] -
			// -1 : 10
			// -2 : 20
			// -3 : 30
			// -4 : 40
			// -5 : 50
			// +1 : 11
			// +2 : 21
			// +3 : 31
			// +4 : 41
			// +5 : 51
			break;

		case 0x47: // Broadcast: BM status
			data.command = 'bro';
			data.value   = 'BM status';
			break;

		case 0x48: // Broadcast: BM button
			data.command = 'bro';
			data.value   = 'BM button';
			break;

		default:
			data.command = 'unk';
			data.value   = Buffer.from(data.msg);
			break;
	}

	log.bus(data);
}

// Emulate button presses
function send_button(button) {
	var button_down = 0x00;
	var button_hold;
	var button_up;

	// Switch statement to determine button, then encode bitmask
	switch (button) {
		case 'power':
			// Get down value of button
			button_down = bitmask.bit_set(button_down, bitmask.bit[1]);
			button_down = bitmask.bit_set(button_down, bitmask.bit[2]);

			// Generate hold and up values
			button_hold = bitmask.bit_set(button_down, bitmask.bit[6]);
			button_up   = bitmask.bit_set(button_down, bitmask.bit[7]);
			break;
	}

	console.log('[MID::RAD] Sending button down: %s', button);

	// Init variables
	var command = 0x48; // Button action
	var packet_down = [command, button_down];
	var packet_up = [command, button_up];

	bus_client.data_send({
		src: 'MID',
		dst: 'RAD',
		msg: packet_down,
	});

	// Prepare and send the up message after 150ms
	setTimeout(() => {
		console.log('[MID::RAD] Sending button up: %s', button);
		bus_client.data_send({
			src: 'MID',
			dst: 'RAD',
			msg: packet_up,
		});
	}, 150);
}

module.exports = {
	parse_in             : (data)        => { parse_in(data); },
	parse_out            : (data)        => { parse_out(data); },
	power_on_if_ready    : ()            => { power_on_if_ready(); },
	send_button          : (button)      => { send_button(button); },
	send_device_status   : (module_name) => { bus_commands.send_device_status(module_name); },
	status_loop          : (action)      => { status_loop(action); },
	text                 : (message)     => { text(message); },
};
