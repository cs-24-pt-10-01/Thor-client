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
}

function socketClosed() {
	if (!currentPanel) {
		return;
	}
	currentPanel.webview.postMessage({ command: 'socketClosed' });
}


const queue = [];

function startSocket(host, port, repo) {
	const writeStream = fs.createWriteStream(__dirname + '/data.json', { flags: 'w' });
	writeStream.write('[');

	let flag = false;

	const sender = setInterval(async () => {
		if (flag) {
			// stop interval
			clearInterval(sender);
			for (const val of queue) {
				const json = JSON.parse(val);
				currentPanel.webview.postMessage({ command: 'data', data: json });
				for (const item of json) {
					writeStream.write(JSON.stringify(item) + ",");
				}
			}
			writeStream.end(() => { endJsonFile(__dirname + '/data.json'); });
			socketClosed();
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
		let string = Buffer.concat([dataBuffer, data]).toString();
		let splits = string.split("]" + endString); // ending of list + endString

		for (let i = 0; i < splits.length; i++) {
			if (i == splits.length - 1) {
				if (splits[i] != "") {
					// saving incomplete data, for next chunk
					dataBuffer = Buffer.from(splits[i]);
				}
				else {
					// clearing buffer
					dataBuffer = Buffer.alloc(0);
				}
				break;
			}
			queue.push(splits[i] + "]");
		}
	});

	client.on("error", (error) => {
		console.log("made a mistake");
		console.log(`Error: ${error.message}`);
	});

	client.on("close", () => {
		flag = true;
		console.log("Connection closed");
	});
}

// ends the json file with a ']'
function endJsonFile(path = 'data.json') {
	if (!fs.existsSync(path)) {
		console.log("no file written");
		return;
	}
	// removing the last comma
	fs.truncateSync(path, fs.statSync(path).size - 1);

	// adding the ']'
	fs.appendFileSync(path, ']', 'utf8');
}

function readFromFile(path) {
	try {
		const data = fs.readFileSync(path);
		const jsonData = JSON.parse(data);
		currentPanel.webview.postMessage({ command: 'data', data: jsonData });

		// simulating stop
		socketClosed();
	}
	catch (err) {
		socketClosed();
		console.error("failed to read file", err);
	}
}

// This method is called when your extension is deactivated
function deactivate() { }


module.exports = {
	activate,
	deactivate
}