const vscode = require('vscode');
const net = require("net");
const fs = require("fs");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	let currentPanel = undefined;

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
							startSocket(message.host, message.port, message.repo);
							return;
						case 'readFromFile':
							readFromFile(message.path);
							return;
					}
				},
				undefined,
				context.subscriptions
			);
		})

	);


	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.startSocket', (ip_arg, port_arg, repo_arg) => {
			startSocket(ip_arg, port_arg, repo_arg);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.UpdateGraph', (id_arg, value_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'updateGraph', id: id_arg, value: value_arg });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.AddGraph', (id_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'addGraph', id: id_arg });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.UpdateStats', (id_arg, first_arg, acc_arg, per_call_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'updateStats', id: id_arg, first: first_arg, acc: acc_arg, per_call: per_call_arg });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.SocketClosed', (dict_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'SocketClosed', dict: dict_arg });
		})
	);

}


var idThreadDict = {};
var dict = {}; //data about the different measurements
//dict[0]: Energy used in first iteration
//dict[1]: total energy used
//dict[2]: count (amount of emasurements taken)
//dict[3]: identifier

function handleData(jsonData) {
	for (const val of jsonData) {
		const identifier = val.local_client_packet.id;
		const threadId = val.local_client_packet.thread_id;

		// checking if the measurement is from an Intel or AMD processor
		const value = val.rapl_measurement.Intel ? val.rapl_measurement.Intel.pkg : val.rapl_measurement.AMD.pkg;

		const operation = val.local_client_packet.operation;

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
				vscode.commands.executeCommand('thorClient.AddGraph', identifier);
				//				   [first, accumulated, amount of times seen, identifier(used for debugging)] //TODO remove debug identifier
				dict[identifier] = [energyUsed, 0, 0, identifier];
			}

			vscode.commands.executeCommand('thorClient.UpdateGraph', identifier, energyUsed);

			dict[identifier][1] += energyUsed;
			dict[identifier][2] += 1;
			vscode.commands.executeCommand('thorClient.UpdateStats', identifier, dict[identifier][0], dict[identifier][1], ((dict[identifier][1]) / (dict[identifier][2])));
		}
	}
}

function startSocket(host, port, repo) {
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

			const jsonData = JSON.parse(dataBufferString);

			handleData(jsonData);

			writeJsonToFile(jsonData, __dirname + '/data.json');

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
		vscode.commands.executeCommand('thorClient.SocketClosed', dict);
		endJsonFile(__dirname + '/data.json');
		console.log("Connection closed");
	});
}

// write data to file, endJsonFile should be called after all date is written
function writeJsonToFile(data, dist = 'data.json') {
	if (!fs.existsSync(dist)) {
		fs.writeFileSync(dist, '[', 'utf8');
	}

	for (const val of data) {
		console.log(val);
		fs.appendFileSync(dist, JSON.stringify(val) + ",", 'utf8');
	}
}

// ends the json file with a ']'
function endJsonFile(dist = 'data.json') {
	// removing the last comma
	fs.truncateSync(dist, fs.statSync(dist).size - 1);

	// adding the ']'
	fs.appendFileSync(dist, ']', 'utf8');
}

function readFromFile(path) {
	try {
		const data = fs.readFileSync(path);

		const jsonData = JSON.parse(data);

		handleData(jsonData);

		// simulating stop
		vscode.commands.executeCommand('thorClient.SocketClosed', dict);
	}
	catch (err) {
		console.error("failed to read file", err);
	}
}

// This method is called when your extension is deactivated
function deactivate() { }


module.exports = {
	activate,
	deactivate
}