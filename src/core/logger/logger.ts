import dotenv from "dotenv";
import * as fs from 'fs';

dotenv.config();

export class Logger {

    // const fs = require('fs');
    fileLog: boolean = true;

    writeLog(message: string, logType: string) {
        const currentDate = new Date();
        const yyyy = currentDate.getFullYear();
        let mm = (currentDate.getMonth() + 1) + '';
        let dd = currentDate.getDate() + '';
        let hh = currentDate.getHours() + '';
        let min = currentDate.getMinutes() + '';
        let ss = currentDate.getSeconds() + '';
        let ms = currentDate.getMilliseconds() + '';
        let today;
        let logFileName = '';
        try {

            //check for file log
            try {
                let tmp: string = process.env.FILE_LOG + '';
                tmp = tmp.toUpperCase().trim();
                if (tmp == 'DISABLED') {
                    this.fileLog = false;
                }
            } catch (error) { }

            //
            if (currentDate.getDate() < 10) { dd = `0${dd}`; }
            //
            if ((currentDate.getMonth() + 1) < 10) { mm = `0${mm}`; }
            //
            if (currentDate.getHours() < 10) { hh = `0${hh}`; }
            //
            if (currentDate.getMinutes() < 10) { min = `0${min}`; }
            //
            if (currentDate.getSeconds() < 10) { ss = `0${ss}`; }
            //
            if (currentDate.getMilliseconds() < 10) { ms = `00${ms}`; }
            if (currentDate.getMilliseconds() < 100) { ms = `0${ms}`; }

            //
            today = yyyy + '' + mm + '' + dd + ':' + hh + '' + min + '' + ss + '.' + ms;
            logFileName = 'logs/' + yyyy + '' + mm + '' + dd + '.log';

            if (logType == '') {
                logType = 'INFO';
            }

            // printing log on console
            console.log(today + ': ' + logType + ': ' + message);

            if (this.fileLog) {
                //writing log in file
                try {
                    // checking for log folder
                    if (!fs.existsSync('logs/')) {
                        fs.mkdirSync('logs/')
                    }

                    let logFile = fs.createWriteStream(logFileName, { flags: 'a' });
                    logFile.write(today + ': ' + logType + ': ' + message + '\n');
                    logFile.end();
                } catch (error) {
                    console.log(new Date() + ': logger/writeLog: Error in Writing log to File : ' + error + ' : ' + message);
                }
            }

        } catch (error) {
            console.log(new Date() + ': logger/writeLog: Catch: ' + error + ' : ' + message);
        }
    }

    public log(message: string) {
        try {
            this.writeLog(message, 'LOG');
        } catch (error) {
            console.log(new Date() + ': logger/log: Catch: ' + error + ': ' + message);
        }
    }

    public error(message: string) {
        try {
            this.writeLog(message, 'ERROR');
        } catch (error) {
            console.log(new Date() + ': logger/error: Catch: ' + error + ': ' + message);
        }
    }

    public info(message: string) {
        try {
            this.writeLog(message, 'INFO');
        } catch (error) {
            console.log(new Date() + ': logger/info: Catch: ' + error + ': ' + message);
        }
    }

    public warn(message: string) {
        try {
            this.writeLog(message, 'WARN');
        } catch (error) {
            console.log(new Date() + ': logger/warn: Catch: ' + error + ': ' + message);
        }
    }

}
export const logger = new Logger();
