const vscode = require('vscode');
const net = require("net");
const fs = require("fs");

/**
 * @param {vscode.ExtensionContext} context
 */

let currentPanel = undefined;

function activate(context) {

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.start', () => {
			if (currentPanel) {
				currentPanel.reveal(vscode.ViewColumn.One);
			} else {
				currentPanel = vscode.window.createWebviewPanel(
					'thorclient',
					'Thor Client',
					vscode.ViewColumn.One,
					{
						enableScripts: true
					}
				);
				// __dirname is the directory of the this file
				currentPanel.webview.html = fs.readFileSync(__dirname + '/webview.html', 'utf8');
				currentPanel.onDidDispose(
					() => {
						currentPanel = undefined;
					},
					undefined,
					context.subscriptions
				);
			}

			currentPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
						case 'startSocket':
							startSocket(message.host, message.port, message.repo, message.est);
							return;
						case 'readFromFile':
							readFromFile(message.path, message.est);
							return;
					}
				},
				undefined,
				context.subscriptions
			);
		})
	);
}

function updateGraph(id_arg, value_arg) {
	if (!currentPanel) {
		return;
	}
	currentPanel.webview.postMessage({ command: 'updateGraph', id: id_arg, value: value_arg });
}

function addGraph(id_arg) {
	if (!currentPanel) {
		return;
	}
	currentPanel.webview.postMessage({ command: 'addGraph', id: id_arg });
}
/* TODO
	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.startSocket', (ip_arg, port_arg, repo_arg, est_arg) => {
			startSocket(ip_arg, port_arg, repo_arg, est_arg);
		})
	);
	*/

function updateStats(id_arg, first_arg, acc_arg, per_call_arg, calls_arg) {
	if (!currentPanel) {
		return;
	}
	currentPanel.webview.postMessage({ command: 'updateStats', id: id_arg, first: first_arg, acc: acc_arg, per_call: per_call_arg, calls: calls_arg });

}

function socketClosed(dict_arg) {
	if (!currentPanel) {
		return;
	}
	currentPanel.webview.postMessage({ command: 'socketClosed', dict: dict_arg });
}



var lastMeasuredValue = -1; //Used to keep track of the last measured value. -1 is not possible
var lastMeasuredTimestamp = -1; //Used to keep track of the timestamp of the last measured value. -1 is not possible
var tempList = [];

function handleDataWrapper(jsonData, shouldEstimate) {
	if (shouldEstimate == false) {
		handleData(jsonData)
	} else {
		const estimatedJsonData = [];
		jsonData.forEach(element => {
			tempList.push(element)
			const value = element.rapl_measurement.Intel ? element.rapl_measurement.Intel.pkg : element.rapl_measurement.AMD.pkg;

			if (lastMeasuredValue == -1) {
				lastMeasuredValue = value;
				lastMeasuredTimestamp = element.process_under_test_packet.timestamp;
			}
			else {
				if (lastMeasuredValue < value) {//a change in value
					const estimatedValues = estimateValues(tempList);
					estimatedJsonData.push(...estimatedValues);
					tempList = []; //Reset
				}
			}
		});
		handleData(estimatedJsonData);
	}
}

function estimateValues(jsonData) {
	const newestElement = jsonData[jsonData.length - 1]; //The newest element has the new (and higher) energy value.
	const newestMeasuredTimestamp = newestElement.process_under_test_packet.timestamp; //timestamp of the newest element
	const newestMeasuredValue = newestElement.rapl_measurement.Intel ? newestElement.rapl_measurement.Intel.pkg : newestElement.rapl_measurement.AMD.pkg; //The value from the newest element

	jsonData.forEach(element => {
		const currentTimestamp = element.process_under_test_packet.timestamp; //timestamp of the current element

		const timePeriod = newestMeasuredTimestamp - lastMeasuredTimestamp; //The time used from the last element to the newest element.
		const timePeriodUsed = currentTimestamp - lastMeasuredTimestamp; //The time the current element have used from the timePeriod

		//handle devide by 0 error.
		let percentTimeUsed = 0;
		if (timePeriod != 0) {
			percentTimeUsed = (timePeriodUsed / timePeriod);
		}

		lastMeasuredTimestamp = currentTimestamp; //with the current element being accounted for, the period of available time is now from the current elements timestamp.
		const valueDiff = newestMeasuredValue - lastMeasuredValue; //The value difference between the old value and the new value.
		const currentEstimatedValue = lastMeasuredValue + (valueDiff * percentTimeUsed); //The estimated energy used is a percentage of the value difference
		element.rapl_measurement.Intel ? (element.rapl_measurement.Intel.pkg = currentEstimatedValue) : (element.rapl_measurement.AMD.pkg = currentEstimatedValue); //set new value
		lastMeasuredValue = currentEstimatedValue; //Set the new previous value

	});
	return jsonData;
}


var idThreadDict = {};
var dict = {}; //data about the different measurements
//dict[0]: Energy used in first iteration
//dict[1]: total energy used
//dict[2]: count (amount of emasurements taken)
//dict[3]: identifier

function handleData(jsonData) {
	for (const val of jsonData) {
		const identifier = val.process_under_test_packet.id;
		const threadId = val.process_under_test_packet.thread_id;

		// checking if the measurement is from an Intel or AMD processor
		const value = val.rapl_measurement.Intel ? val.rapl_measurement.Intel.pkg : val.rapl_measurement.AMD.pkg;

		const operation = val.process_under_test_packet.operation;

		const key = identifier + threadId;
		if (operation == "Start") {
			idThreadDict[key] = value;
		} else {
			if (idThreadDict[key] == undefined) {
				console.log("Start not found for key: " + key);
				continue
			}
			const energyUsed = value - idThreadDict[key];

			if (!(identifier in dict)) {
				addGraph(identifier);
				//				   [first, accumulated, amount of times seen, identifier(used for debugging)] //TODO remove debug identifier
				dict[identifier] = [energyUsed, 0, 0, identifier];
			}

			updateGraph(identifier, energyUsed);

			dict[identifier][1] += energyUsed;
			dict[identifier][2] += 1;
			const avg = (dict[identifier][1] / dict[identifier][2]).toFixed(2) // rounded to two decimals
			// TODO to fixed
			vscode.commands.executeCommand('thorClient.UpdateStats', identifier, dict[identifier][0].toFixed(2), dict[identifier][1].toFixed(2), avg, dict[identifier][2]);
		}
	}
}

const queue = [];

function startSocket(host, port, repo) {
	const writeStream = fs.createWriteStream(__dirname + '/data.json', { flags: 'w' });
	writeStream.write('[');

	let flag = false;

	const sender = setInterval(async () => {
		if (flag) {
			clearInterval(sender);
			for (const val of queue) {
				const json = JSON.parse(val);
				await currentPanel.webview.postMessage({ command: 'data', data: json });
				for (const item of json) {
					writeStream.write(JSON.stringify(item) + ",");
				}
			}
			endJsonFile(__dirname + '/data.json');
			writeStream.end();
		}
		else if (queue.length > 0) {
			const next = queue.shift();
			const json = JSON.parse(next);
			await currentPanel.webview.postMessage({ command: 'data', data: json });

			for (const item of json) {
				writeStream.write(JSON.stringify(item) + ",");
			}
		}
	}, 100); // delay for prioritizing accepting data

	const endString = "end"; // string used to indicate end of data by the server
	const end = new Buffer.from(endString);

	// if no repo, indicating observer by sending "none"
	if (repo == "") {
		repo = "none";
	}

	// Buffer used for storing data until endString is found
	let dataBuffer = Buffer.alloc(0);

	const client = net.createConnection(port, host, () => {
		client.write("1"); // indicating client stream
		client.write(repo + "#");
		console.log('Connected');
	});

	client.on("data", (data) => {
		// if the endString is found then parse data else concat to buffer
		if (data.subarray(data.length - end.length).toString() == endString) {
			dataBuffer = Buffer.concat([dataBuffer, data]);

			// removing endString from data
			const dataBufferString = dataBuffer.toString().slice(0, -end.length);

			queue.push(dataBufferString);
			/* TODO move data wrapper
			const jsonData = JSON.parse(dataBufferString);
			handleDataWrapper(jsonData, shouldEstimate);

			writeJsonToFile(jsonData, __dirname + '/data.json');
			*/

			// clearing buffer
			dataBuffer = Buffer.alloc(0);
		}
		else {
			dataBuffer = Buffer.concat([dataBuffer, data]);
		}
	});

	client.on("error", (error) => {
		console.log("made a mistake");
		console.log(`Error: ${error.message}`);
	});

	client.on("close", () => {
		socketClosed(dict);
		flag = true;
		while (queue.length > 0) {

		}
		/* TODO move data wrapper
		if (shouldEstimate) {
			if (tempList.length != 0) {//check if there are any leftover elements
				handleData(tempList); //since no change has occurd after these elements, it is not possible to estimate their value.
			}
		}
		*/

		vscode.commands.executeCommand('thorClient.SocketClosed', dict);
		endJsonFile(__dirname + '/data.json');
		console.log("Connection closed");
	});
}

// write data to file, endJsonFile should be called after all date is written
async function writeJsonToFile(data, path = 'data.json') {
	if (!fs.existsSync(path)) {
		await fs.writeFile(path, '[', 'utf8', (err) => {
			if (err) {
				console.log("failed to write file", err);
			}
		});
	}

	const json = JSON.parse(data);

	for (const val of json) {
		await fs.appendFile(path, JSON.stringify(val) + ",", 'utf8', (err) => {
			if (err) {
				console.log("failed to write file", err);
			}
		});
		//fs.appendFileSync(path, JSON.stringify(val) + ",", 'utf8');
	}
}

// ends the json file with a ']'
async function endJsonFile(path = 'data.json') {
	if (!fs.existsSync(path)) {
		console.log("no file written");
		return;
	}
	// removing the last comma
	fs.truncateSync(path, fs.statSync(path).size - 1);

	// adding the ']'
	fs.appendFileSync(path, ']', 'utf8');
}

function readFromFile(path, shouldEstimate) {
	try {
		const data = fs.readFileSync(path);
		const jsonData = JSON.parse(data);
		currentPanel.webview.postMessage({ command: 'data', data: jsonData });

		// simulating stop
		socketClosed(dict);
		/* TODO move data wrapper
		handleDataWrapper(jsonData, shouldEstimate);

		// simulating stop
		if (shouldEstimate) {
			if (tempList.length != 0) {//check if there are any leftover elements
				handleData(tempList); //since no change has occurd after these elements, it is not possible to estimate their value.
			}
		}
		vscode.commands.executeCommand('thorClient.SocketClosed', dict);
		*/
	}
	catch (err) {
		socketClosed(dict);
		console.error("failed to read file", err);
	}
}

// This method is called when your extension is deactivated
function deactivate() { }


module.exports = {
	activate,
	deactivate
}