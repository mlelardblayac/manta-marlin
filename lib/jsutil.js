/*
 * lib/jsutil.js: string and error utility routines
 */

var mod_assert = require('assert');
var mod_util = require('util');

exports.jsSprintf = jsSprintf;
exports.jsError = jsError;

/*
 * Stripped down version of s[n]printf(3c).  We make a best effort to throw an
 * exception when given a format string we don't understand, rather than
 * ignoring it, so that we won't break existing programs if/when we go implement
 * the rest of this.
 *
 * This implementation currently supports specifying
 *	- field alignment ('-' flag),
 * 	- zero-pad ('0' flag)
 *	- always show numeric sign ('+' flag),
 *	- field width
 *	- conversions for strings, decimal integers, and floats (numbers).
 *	- argument size specifiers.  These are all accepted but ignored, since
 *	  Javascript has no notion of the physical size of an argument.
 *
 * Everything else is currently unsupported, most notably precision, unsigned
 * numbers, non-decimal numbers, and characters.
 */
function jsSprintf(fmt)
{
	var regex = [
	    '([^%]*)',				/* non-special */
	    '%',				/* start of format */
	    '([\'\\-+ #0]*?)',			/* flags (optional) */
	    '([1-9]\\d*)?',			/* width (optional) */
	    '(\\.([1-9]\\d*))?',		/* precision (optional) */
	    '[lhjztL]*?',			/* length mods (ignored) */
	    '([diouxXfFeEgGaAcCsSp%jr])'	/* conversion */
	].join('');

	var re = new RegExp(regex);
	var args = Array.prototype.slice.call(arguments, 1);
	var flags, width, precision, conversion;
	var left, pad, sign, arg, match;
	var ret = '';
	var argn = 1;

	mod_assert.equal('string', typeof (fmt));

	while ((match = re.exec(fmt)) !== null) {
		ret += match[1];
		fmt = fmt.substring(match[0].length);

		flags = match[2] || '';
		width = match[3] || 0;
		precision = match[4] || '';
		conversion = match[6];
		left = false;
		sign = false;
		pad = ' ';

		if (conversion == '%') {
			ret += '%';
			continue;
		}

		if (args.length === 0)
			throw (new Error('too few args to sprintf'));

		arg = args.shift();
		argn++;

		if (flags.match(/[\' #]/))
			throw (new Error(
			    'unsupported flags: ' + flags));

		if (precision.length > 0)
			throw (new Error(
			    'non-zero precision not supported'));

		if (flags.match(/-/))
			left = true;

		if (flags.match(/0/))
			pad = '0';

		if (flags.match(/\+/))
			sign = true;

		switch (conversion) {
		case 's':
			if (arg === undefined || arg === null)
				throw (new Error('argument ' + argn +
				    ': attempted to print undefined or null ' +
				    'as a string'));
			ret += doPad(pad, width, left, arg);
			break;

		case 'd':
			arg = Math.floor(arg);
			/*jsl:fallthru*/
		case 'f':
			sign = sign && arg > 0 ? '+' : '';
			ret += sign + doPad(pad, width, left,
			    arg.toString());
			break;

		case 'j': /* non-standard */
			if (width === 0)
				width = 10;
			ret += mod_util.inspect(arg, false, width);
			break;

		case 'r': /* non-standard */
			ret += dumpException(arg);
			break;

		default:
			throw (new Error('unsupported conversion: ' +
			    conversion));
		}
	}

	ret += fmt;
	return (ret);
}

function doPad(chr, width, left, str)
{
	var ret = str;

	while (ret.length < width) {
		if (left)
			ret += chr;
		else
			ret = chr + ret;
	}

	return (ret);
}

function dumpException(ex)
{
	var ret;

	if (!(ex instanceof Error))
		throw (new Error(caSprintf('invalid type for %%r: %j', ex)));

	/*
	 * Note that V8 prepends "ex.stack" with ex.toString().
	 */
	ret = 'EXCEPTION: ' + ex.constructor.name + ': ' + ex.stack;

	if (!ex.cause)
		return (ret);

	for (ex = ex.cause(); ex; ex = ex.cause ? ex.cause() : null)
		ret += '\nCaused by: ' + dumpException(ex);

	return (ret);
}

/*
 * Like JavaScript's built-in Error class, but supports a "cause" argument and a
 * printf-style message.  The cause argument can be null.  For example:
 *
 *	if (err)
 *		throw (new jsError(err, 'operation "%s" failed', opname));
 *
 * If err.message is "file not found" and "opname" is "rm", then the thrown
 * exception's toString() would return:
 *
 *	operation "rm" failed: file not found
 *
 * This is useful for annotating exceptions up the stack, rather than getting an
 * extremely low-level error (like "file not found") for a potentially much
 * higher level operation.
 *
 * Additionally, when printed using jsSprintf using %r, each exception's stack
 * is printed.
 */
function jsError(cause)
{
	var args, tailmsg;

	args = Array.prototype.slice.call(arguments, 1);
	tailmsg = args.length > 0 ? jsSprintf.apply(null, args) : '';
	this.jse_shortmsg = tailmsg;

	if (cause) {
		mod_assert.ok(cause instanceof Error);
		this.jse_cause = cause;
		this.jse_summary = tailmsg + ': ' + cause.message;
	} else {
		this.jse_summary = tailmsg;
	}

	this.message = this.jse_summary;
	Error.apply(this, [ this.jse_summary ]);

	if (Error.captureStackTrace)
		Error.captureStackTrace(this, arguments.callee);
}

jsError.prototype = new Error();
jsError.prototype.constructor = jsError;
jsError.prototype.name = jsError;

jsError.prototype.toString = function ()
{
	return (this.jse_summary);
};

jsError.prototype.cause = function ()
{
	return (this.jse_cause);
};