// apiResponse.js
exports.sendSuccess = (res, data, statusCode = 200) => {
    res.status(statusCode).json({
      success: true,
      data
    });
  };
  
  exports.sendError = (res, message, statusCode = 500) => {
    res.status(statusCode).json({
      success: false,
      message
    });
  };
  