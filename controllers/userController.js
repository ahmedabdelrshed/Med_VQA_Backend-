const User = require("../models/userModel");
const { validationResult } = require("express-validator");
const appError = require("../utils/appError");
const { ERROR } = require("../utils/httpStatus");
var bcrypt = require("bcryptjs");
const createToken = require("../utils/createToken");
const { isStrongPassword } = require("validator");
const jwt = require("jsonwebtoken");
const {contactEmail, verificationEmail} = require("../utils/SendVerificationEmail");
const sendResetPasswordEmail = require("../utils/sendResetPasswordEmail");
const cloudinary = require('../utils/cloudinaryConfig');
const streamifier = require("streamifier");





const register = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const error = appError.createError("User Already Exist", 400, ERROR);
    return next(error);
  }
  if (!isStrongPassword(password)) {
    const error = appError.createError(
      "Password should be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      400,
      ERROR
    );
    return next(error);
  }
  try {
    const hashPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ ...req.body, password: hashPassword });
    const token = createToken(newUser, "15m");
    newUser.token = token;
    await newUser.save();
    await verificationEmail(newUser.email, token);
    res.status(201).json({
      message: "Verification email sent successfully Please check Your Email",
    });
  } catch (error) {
    next(error);
  }
};

const login =async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try{
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = await User.findOne({ email}).select("+password");

  if (!user) {
    const error = appError.createError("User not found", 404, ERROR);
    return next(error);
    }
    if (!user.isVerified) {
      const error = appError.createError("Email is not verified please check your email to Verify your Account", 403, ERROR);
      return next(error);
    }

  const matchedPassword=await bcrypt.compare(password, user.password);

  if (!matchedPassword) {
    const error = appError.createError("Incorrect Password", 401, ERROR);
    return next(error);
  }
  const token = createToken(user);
  user.token = token;
  res.json({
    message: "Login successful",
    token: token,
  })}
  catch (error) {
    next(error);
  };

};


const updateUser = async (req, res, next) => {
  try {
    const userId = req.currentUser.userId;
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return next(appError.createError("User not found", 404, "ERROR"));
    }

    if (req.body.email) {
      return next(appError.createError("Email cannot be updated", 400, "ERROR"));
    }

    
    await handlePasswordUpdate(req.body, user);

    
    validateNameLength(req.body);

    if (req.file) {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "med_VQA_Data/profile-pictures", public_id: userId },

        async (error, result) => {
          if (error) {
            return next(appError.createError("Cloudinary Upload Failed", 500, "ERROR"));
          }

          req.body.avatar = result.secure_url; 

          const updatedUser = await User.findByIdAndUpdate(userId, req.body, {
            new: true,
            runValidators: true,
          });

          if (!updatedUser) {
            return next(appError.createError("User update failed", 500, "ERROR"));
          }

          res.json({
            message: "Profile updated successfully",
            updatedUser,
          });
        }
      );

      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    } else {
      const updatedUser = await User.findByIdAndUpdate(userId, req.body, {
        new: true,
        runValidators: true,
      });

      if (!updatedUser) {
        return next(appError.createError("User update failed", 500, "ERROR"));
      }

      res.json({
        message: "Profile updated successfully",
        updatedUser,
      });
    }
  } catch (error) {
    next(error);
  }
};

const contactUs = async (req, res, next) => {
  try {
    const userEmail = req.currentUser?.email;
    const message = req.body?.message;

    if (!message) {
      return next(appError.createError("Message is required", 400, "ERROR"));
    }

    const result = await contactEmail(userEmail, message);

    if (!result.success) {
      return next(appError.createError(result.message, 500, "ERROR"));
    }

    res.status(200).json({ success: true, message: "Message sent successfully" });
  } catch (error) {
    next(error);
  }
};



const handlePasswordUpdate = async (updateData, user) => {
    if (updateData.password && updateData.oldPassword) {
      const matchedPassword = await bcrypt.compare(updateData.oldPassword, user.password);
      if (!matchedPassword) {
        throw appError.createError("Incorrect old password", 400, "ERROR");
      }
      if (!isStrongPassword(updateData.password)) {
        throw appError.createError(
          "Password should be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
          400,
          "ERROR"
        );
      }
      const hashedPassword = await bcrypt.hash(updateData.password, 10);
      updateData.password = hashedPassword;
  
      delete updateData.oldPassword;
    } else if (updateData.password && !updateData.oldPassword) {
      throw appError.createError("Old password is required", 400, "ERROR");
    }
  };
  const validateNameLength = (updateData) => {
    const { firstName, lastName } = updateData;
  
    if (firstName && (firstName.length < 3 || firstName.length > 12)) {
      throw appError.createError("First name must be between 3 and 12 characters", 400, "ERROR");
    }
  
    if (lastName && (lastName.length < 3 || lastName.length > 12)) {
      throw appError.createError("Last name must be between 3 and 12 characters", 400, "ERROR");
    }
  };
    

const verifyEmail = async(req,res) => {
  const { token } = req.params;
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const userEmail = decoded.email
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user.isVerified) {
    const error = appError.createError('User is already verified', 400, ERROR)
    return next(error);
  }
  user.isVerified = true;
  await user.save();
  res.json({ message: "User verified successfully you can login successfully" });
  } catch (err) {
    const error = appError.createError("Invalid token", 401, ERROR);
    return next(error);
  }

}

const forgetPassword = async(req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const token = createToken(user, "10m");
  await sendResetPasswordEmail(email,token)
  res.json({ message: "Reset password link sent successfully" });
}
const resetPassword = async (req, res) => { 
  const token = req.params.token
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: "Password is required" });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "Password should be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    res.json({ message: "Password reset successfully" });
    
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
    
  }
}
module.exports = {
  register,
  login,
  updateUser,
  verifyEmail,
  contactUs,
  forgetPassword,
  resetPassword,
};
